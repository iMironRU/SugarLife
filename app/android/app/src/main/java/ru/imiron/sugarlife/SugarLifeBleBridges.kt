package ru.imiron.sugarlife

import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import ru.imiron.sugarlife.drivers.medtronic.PumpTransportBridge
import ru.imiron.sugarlife.drivers.sibionics.SensorTransportBridge
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue

/** Нативный Android BLE — зеркало Swift `SugarLifeBleBridges.swift` (логика из проверенного спайка).
 *  Домен/протоколы (Sibionics AA55, Medtronic) остаются в KMP; здесь только транспорт (CoreBluetooth ↔ BluetoothGatt). */

private const val TAG = "SugarLifeBLE"   // issue #33: adb logcat -s SugarLifeBLE — диагностируемость железо-сессии
private fun uuid16(v: String): UUID = UUID.fromString("0000$v-0000-1000-8000-00805f9b34fb")
private val CCCD = uuid16("2902")
// Телеметрия периферала (issue #38): заряд Battery Service 0x180F, прошивка DIS 0x180A, rssi.
private val BATTERY_CHAR = uuid16("2A19")
private val FIRMWARE_CHAR = uuid16("2A26")
/** Сток телеметрии натив→движок: плагин ставит engine.submitTelemetry; BleLink зовёт с json {bleId,batteryPct?,firmware?,rssi?}. */
var telemetrySink: ((String) -> Unit)? = null

/** Короткая форма стандартного Bluetooth-UUID (как CBUUID на iOS): 0000FF30-0000-1000-8000-00805f9b34fb → "FF30".
 *  Каталог матчит короткие ("FF30"); Android же отдаёт полный 128-битный → без нормализации совпадения нет.
 *  Кастомные 128-битные (RileyLink) остаются полными. */
private fun shortUuid(u: UUID): String {
    val s = u.toString().lowercase()
    return if (s.startsWith("0000") && s.endsWith("-0000-1000-8000-00805f9b34fb"))
        s.substring(4, 8).uppercase() else s.uppercase()
}
private val mainHandler = Handler(Looper.getMainLooper())
/** Сколько ждём колбэк одной GATT-операции. Норма — доли секунды; это срок «стек потерял ответ». */
private const val ОП_СРОК_МС = 8000L
/** Сколько ждём discovery, прежде чем отпустить отложенные команды их обычным отказом (#348). */
private const val DISCOVERY_СРОК_МС = 15000L

// Sibionics
private val SIB_SERVICE = uuid16("FF30")
private val SIB_NOTIFY = uuid16("FF31")
private val SIB_WRITE = uuid16("FF32")
private val SIB_MAC = uuid16("2A25")   // Serial Number (сервис 0x180A), 6 байт реверс
// OrangeLink/RileyLink (помпа)
private val RL_SERVICE = UUID.fromString("0235733B-99C5-4197-B856-69219C2A3845")
private val RL_DATA = UUID.fromString("C842E849-5028-42E2-867C-016ADADA9155")
private val RL_RESP = UUID.fromString("6E6C7910-B89E-43A5-A0FE-50C5E2B81F4A")

/** Обобщённый линк к одному peripheral (по MAC). Discover ВСЕХ сервисов (MAC 0x2A25 лежит в 0x180A, не в FF30).
 *  GATT-операции сериализуются очередью — Android держит одну операцию за раз (иначе тихие сбои). */
@SuppressLint("MissingPermission")
@Suppress("DEPRECATION")
class BleLink(
    private val context: Context,
    private val address: String,
    private val notifyChars: Set<UUID>,
) {
    var onState: ((String) -> Unit)? = null
    private val notifyHandlers = HashMap<UUID, (ByteArray) -> Unit>()
    private val readHandlers = HashMap<UUID, (ByteArray?) -> Unit>()
    private val chars = HashMap<UUID, BluetoothGattCharacteristic>()
    private var gatt: BluetoothGatt? = null

    private val opQueue = ConcurrentLinkedQueue<() -> Unit>()
    private var opBusy = false
    /* Сторож очереди (SugarLife#344, второй этаж той же поломки).

       Очередь двигает opDone(), а зовут его колбэки BluetoothGatt. Не пришёл колбэк — не
       пришёл и opDone: opBusy остаётся true НАВСЕГДА, и всё, что встало в очередь после,
       не выполняется никогда. Молча: ни ошибки, ни лога, ни отказа.

       Это то же «одна команда останавливает драйвер», но этажом ниже: срок на команду
       вернёт ядру «нет ответа», а писать в характеристику мы после этого всё равно
       перестанем. Android теряет колбэки — это свойство стека, не предположение.

       Поколение нужно, чтобы опоздавший колбэк не сдвинул очередь дважды: сторож снял
       операцию, следующая пошла, и тут приходит ответ на снятую. */
    private var opПоколение = 0
    private var opСторож: Runnable? = null
    @Synchronized private fun enqueue(op: () -> Unit) { opQueue.add(op); pump() }
    @Synchronized private fun opDone() {
        opСторож?.let(mainHandler::removeCallbacks); opСторож = null
        opBusy = false; pump()
    }
    @Synchronized private fun pump() {
        if (opBusy) return
        val op = opQueue.poll() ?: return
        opBusy = true
        val поколение = ++opПоколение
        val сторож = Runnable {
            synchronized(this) {
                if (!opBusy || opПоколение != поколение) return@Runnable
                Log.w(TAG, "GATT-операция $address не ответила за ${ОП_СРОК_МС}мс — снимаем, иначе очередь встанет насовсем")
                opСторож = null; opBusy = false
            }
            pump()
        }
        opСторож = сторож
        mainHandler.postDelayed(сторож, ОП_СРОК_МС)
        op()
    }

    fun subscribe(char: UUID, handler: (ByteArray) -> Unit) { notifyHandlers[char] = handler }

    /* Операции ждут discovery (SugarLife#348).

       `connect()` возвращается СРАЗУ: connectGatt асинхронный, соединение и discovery
       приходят колбэками позже. А контракт транспорта читается как «связь готова», и
       ядро сразу шлёт первую команду. На живом телефоне между ними было ЧЕТЫРЕ
       МИЛЛИСЕКУНДЫ: запись уходила в пустой `chars`, отбрасывалась, драйвер уходил на
       бэкофф, переподключался — и попадал в ту же щель снова. Бесконечно, при живом
       блютусе и исправном мосте.

       Сенсор не страдал по случайности: его драйвер сам ждёт состояния линка. То есть
       поломка была не в помпе и не в OrangeLink, а в порядке действий — и снаружи, из
       общего кода, её не видно никак: «до discovery писать нельзя» знает только натив.

       Копим и отпускаем одной пачкой. Но НЕ НАВСЕГДА: не случилось discovery за срок —
       отпускаем всё равно, и каждая операция уходит своим обычным путём отказа. Иначе
       вернём ровно то бесконечное ожидание, которое чинили в #344. */
    private var найдены = false
    private val доГотовности = ArrayList<() -> Unit>()
    private var сторожDiscovery: Runnable? = null

    private fun приГотовности(op: () -> Unit) {
        val ждём = synchronized(this) { if (найдены) false else { доГотовности.add(op); true } }
        if (!ждём) op()
    }
    private fun отпуститьОтложенные(причина: String) {
        val список = synchronized(this) {
            сторожDiscovery?.let(mainHandler::removeCallbacks); сторожDiscovery = null
            val l = ArrayList(доГотовности); доГотовности.clear(); l
        }
        if (список.isNotEmpty()) Log.d(TAG, "$address: отпускаю ${список.size} отложенных операций ($причина)")
        список.forEach { it() }
    }

    fun connect() {
        // Свежая GATT-сессия (реконнект): сбрасываем состояние старой, иначе застрявшая операция/характеристика мешает.
        chars.clear(); readHandlers.clear(); opQueue.clear(); opBusy = false
        synchronized(this) { найдены = false; доГотовности.clear() }
        сторожDiscovery?.let(mainHandler::removeCallbacks)
        val сд = Runnable {
            Log.w(TAG, "$address: discovery не завершился за ${DISCOVERY_СРОК_МС}мс — отложенные команды пойдут своим отказом")
            отпуститьОтложенные("сдались ждать discovery")
        }
        сторожDiscovery = сд
        mainHandler.postDelayed(сд, DISCOVERY_СРОК_МС)
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        val device = adapter.getRemoteDevice(address)
        onState?.invoke("Connecting")
        Log.d(TAG, "connect $address")
        gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnect() {
        Log.d(TAG, "disconnect $address")
        // Отложенное отпускаем: иначе чтение, начатое до разрыва, не ответит никогда.
        отпуститьОтложенные("разрыв связи")
        gatt?.disconnect(); gatt?.close(); gatt = null
    }

    fun write(char: UUID, bytes: ByteArray) = приГотовности { enqueue {
        val g = gatt; val c = chars[char]
        /* Два РАЗНЫХ отказа, и раньше они были неотличимы — оба выглядели как «прибор не
           отвечает» (#347). Нет GATT — не подключились, чинится подключением. Нет
           характеристики — подключились, но пишем не туда, чинится разбором протокола.
           Молча выброшенная команда это потерянная улика: её искали дважды. */
        if (g == null) { Log.w(TAG, "запись ${shortUuid(char)} отброшена: нет GATT-сессии с $address"); opDone(); return@enqueue }
        if (c == null) {
            Log.w(TAG, "запись ${shortUuid(char)} отброшена: у $address нет такой характеристики; есть: ${chars.keys.joinToString { shortUuid(it) }}")
            opDone(); return@enqueue
        }
        c.writeType = if (c.properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0)
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        c.value = bytes
        g.writeCharacteristic(c)
    } }

    // Телеметрия периферала (issue #38): частичная эмиссия — null-поле движок не затирает.
    private fun emitTelemetry(batteryPct: Int? = null, firmware: String? = null, rssi: Int? = null) {
        val parts = StringBuilder("\"bleId\":\"$address\"")
        if (batteryPct != null) parts.append(",\"batteryPct\":$batteryPct")
        if (firmware != null) parts.append(",\"firmware\":\"${firmware.replace("\"", "")}\"")
        if (rssi != null) parts.append(",\"rssi\":$rssi")
        telemetrySink?.invoke("{$parts}")
    }
    private fun readTelemetry(g: BluetoothGatt) {   // заряд/прошивка/rssi, если периферал их отдаёт
        chars[BATTERY_CHAR]?.let { read(BATTERY_CHAR) { d -> d?.firstOrNull()?.let { emitTelemetry(batteryPct = it.toInt() and 0xFF) } } }
        chars[FIRMWARE_CHAR]?.let { read(FIRMWARE_CHAR) { d -> d?.let { emitTelemetry(firmware = String(it)) } } }
        g.readRemoteRssi()
    }

    fun read(char: UUID, completion: (ByteArray?) -> Unit) = приГотовности { enqueue {
        val g = gatt; val c = chars[char]
        if (g == null) { Log.w(TAG, "чтение ${shortUuid(char)} отброшено: нет GATT-сессии с $address"); completion(null); opDone(); return@enqueue }
        if (c == null) {
            Log.w(TAG, "чтение ${shortUuid(char)} отброшено: у $address нет такой характеристики; есть: ${chars.keys.joinToString { shortUuid(it) }}")
            completion(null); opDone(); return@enqueue
        }
        readHandlers[char] = completion
        g.readCharacteristic(c)
    } }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
            // issue #33: status ≠ 0 (напр. 133 GATT_ERROR) — виновник тихих сбоев коннекта; логируем всегда.
            Log.d(TAG, "connState addr=$address status=$status newState=$newState")
            if (status != BluetoothGatt.GATT_SUCCESS) Log.w(TAG, "connState НЕ-успех status=$status (133=GATT_ERROR/недоступен) addr=$address")
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    onState?.invoke("Connected")
                    // Быстрый интервал связи (7.5мс) — стабильнее при потоке данных, меньше обрывов на Android.
                    g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
                    g.discoverServices()
                }
                BluetoothProfile.STATE_DISCONNECTED -> { onState?.invoke("Disconnected"); opBusy = false; opQueue.clear() }
            }
        }

        override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
            Log.d(TAG, "servicesDiscovered addr=$address status=$status services=${g.services.size}")
            /* ЧТО именно у прибора есть — одной строкой на сервис, один раз за сессию
               (#347). Раньше писали только количество, и для незнакомого моста это был
               главный вопрос первых пяти минут: наши ли у него характеристики или мы всё
               это время пишем в никуда. Догадку такой список превращает в факт — и он же
               нужен каталогу устройств, потому что следующий мост приедет со своими. */
            for (s in g.services) {
                Log.d(TAG, "  сервис ${shortUuid(s.uuid)}: ${s.characteristics.joinToString { shortUuid(it.uuid) }}")
            }
            for (s in g.services) for (c in s.characteristics) {
                chars[c.uuid] = c
                if (notifyChars.contains(c.uuid)) {
                    g.setCharacteristicNotification(c, true)
                    c.getDescriptor(CCCD)?.let { d ->
                        d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        enqueue { g.writeDescriptor(d) }
                    }
                }
            }
            onState?.invoke("Streaming")   // discovery завершён — как в iOS (link=Streaming перед readMac)
            // Теперь можно писать: всё, что пришло раньше времени, уходит здесь (#348).
            synchronized(this@BleLink) { найдены = true }
            отпуститьОтложенные("discovery завершён")
            readTelemetry(g)   // заряд/прошивка/rssi, если периферал их отдаёт (issue #38)
        }

        override fun onReadRemoteRssi(g: BluetoothGatt, rssi: Int, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) emitTelemetry(rssi = rssi)   // близость периферала (issue #38)
        }

        override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) { opDone() }
        override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) { opDone() }

        override fun onCharacteristicRead(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
            val v = if (status == BluetoothGatt.GATT_SUCCESS) c.value else null
            readHandlers.remove(c.uuid)?.invoke(v)
            opDone()
        }

        override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
            notifyHandlers[c.uuid]?.invoke(c.value ?: ByteArray(0))
        }
    }
}

/** Мост сенсора Sibionics → [SensorTransportBridge] (тот же контракт, что iOS SensorBridge). */
class AndroidSensorBridge(context: Context, bleId: String) : SensorTransportBridge {
    private val link = BleLink(context, bleId, notifyChars = setOf(SIB_NOTIFY))
    private var onDataCb: ((ByteArray) -> Unit)? = null

    override fun onLink(callback: (String) -> Unit) { link.onState = callback }
    override fun onData(callback: (ByteArray) -> Unit) {
        onDataCb = callback
        link.subscribe(SIB_NOTIFY) { d -> onDataCb?.invoke(d) }
    }
    override fun connect() = link.connect()

    override fun readMac(callback: (ByteArray?) -> Unit) {
        // 0x2A25 (сервис 0x180A) открывается чуть позже FF30 → ретрай ~6с; MAC 6 байт РЕВЕРС (как в спайке).
        attemptMac(12, callback)
    }
    private fun attemptMac(tries: Int, callback: (ByteArray?) -> Unit) {
        link.read(SIB_MAC) { d ->
            when {
                d != null && d.size == 6 -> callback(d.reversedArray())
                tries > 1 -> mainHandler.postDelayed({ attemptMac(tries - 1, callback) }, 500)
                else -> callback(null)
            }
        }
    }

    override fun write(bytes: ByteArray) = link.write(SIB_WRITE, bytes)
    override fun disconnect() = link.disconnect()
}

/** Мост помпы Medtronic через OrangeLink/RileyLink → [PumpTransportBridge] (зеркало iOS PumpBridge). */
class AndroidPumpBridge(context: Context, bleId: String) : PumpTransportBridge {
    /* Запас времени НА ТРАНСПОРТ (SugarLifeCore#80). Срок ответа складывается из двух
       разных вещей: сколько мост держит радио — знает протокол, сколько добавит BLE-стек —
       знает платформа. Раньше их смешивали в одном числе и подбирали на глаз (3000 здесь,
       5000 там, 8000 у сторожа).

       7,5 с — цифра AndroidAPS (EXPECTED_MAX_BLUETOOTH_LATENCY_MS), у них это работает на
       том же зоопарке телефонов. У iOS ориентир вдвое меньше, и разница честная: стек
       Android заметно менее предсказуем. */
    override val bleLatencyMs: Long = 7500

    private val link = BleLink(context, bleId, notifyChars = setOf(RL_RESP))
    private var pending: ((ByteArray) -> Unit)? = null
    private var срок: Runnable? = null

    /* Ровно один ответ на команду — и он есть ВСЕГДА (SugarLife#344).
     
       Было так: колбэк складывался в `pending` и ждал нотификации моста. Не ответил мост —
       не ответили и мы, никогда: корутина драйвера повисала навсегда, без ошибки и без
       следующей пробы. На живом железе это выглядело как «помпа не подключается» — восемь
       минут одной строки в логе, при живом сенсоре и мосте на связи.
     
       `timeoutMs` в сигнатуре был и молча игнорировался. Хуже, чем отсутствовать: ядро
       рассчитывало на отказ по сроку и шло дальше, а расчёт не выполнялся.
     
       ПОЧЕМУ ПУСТОЙ МАССИВ. Колбэк принимает ByteArray и канала ошибки не имеет. Пустой
       разбирается у ядра как `Response.Error(-1)` — «ответа нет». Соблазн прислать 0xAA
       (RX_TIMEOUT) велик и неверен: этот код значит «мост ответил, что помпа промолчала»,
       а у нас промолчал сам мост. Разные поломки чинятся по-разному, и путать их нельзя. */
    private fun завершить(данные: ByteArray) {
        val cb = synchronized(this) {
            срок?.let(mainHandler::removeCallbacks); срок = null
            val c = pending; pending = null; c
        } ?: return
        cb(данные)
    }

    override fun onLink(callback: (String) -> Unit) { link.onState = callback }
    override fun connect() {
        // Ответ приходит нотификацией respCount → читаем data → отдаём ожидающему.
        link.subscribe(RL_RESP) {
            link.read(RL_DATA) { data -> завершить(data ?: ByteArray(0)) }
        }
        link.connect()
    }
    override fun command(bytes: ByteArray, timeoutMs: Long, callback: (ByteArray) -> Unit) {
        /* Предыдущая команда, если ещё висит, завершается здесь же. Раньше её колбэк
           просто затирался новым — то есть терялся вместе с корутиной, которая его ждала. */
        завершить(ByteArray(0))
        synchronized(this) { pending = callback }
        if (timeoutMs > 0) {
            val r = Runnable {
                Log.w(TAG, "мост молчит ${timeoutMs}мс на команду 0x%02X — отвечаем «нет ответа»"
                    .format(bytes.firstOrNull()?.toInt()?.and(0xFF) ?: -1))
                завершить(ByteArray(0))
            }
            synchronized(this) { срок = r }
            mainHandler.postDelayed(r, timeoutMs)
        }
        link.write(RL_DATA, bytes)
    }
    /* Разрыв — тоже ответ. Иначе команда, отправленная перед disconnect, ждала бы свой
       срок уже после того, как ждать стало нечего. */
    override fun disconnect() { завершить(ByteArray(0)); link.disconnect() }
}

/** Скан эфира → engine.submitAdvertisement (JSON: bleId=MAC, name, serviceUuids, rssi). */
@SuppressLint("MissingPermission")
class SugarLifeScanner(context: Context, private val onAdvertisement: (String) -> Unit) {
    private val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    private var scanning = false

    private val callback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val dev = result.device
            val services = JSONArray()
            result.scanRecord?.serviceUuids?.forEach { services.put(shortUuid(it.uuid)) }
            val dto = JSONObject()
                .put("bleId", dev.address)
                .put("name", result.scanRecord?.deviceName)
                .put("serviceUuids", services)
                .put("rssi", result.rssi)
            // issue #33: видно, ЧТО реально приходит в скан (T1: находится ли GS1 после extended-фикса #30).
            Log.d(TAG, "adv ${dev.address} name=${result.scanRecord?.deviceName} svc=$services rssi=${result.rssi}")
            onAdvertisement(dto.toString())
        }

        override fun onScanFailed(errorCode: Int) { Log.w(TAG, "scan FAILED errorCode=$errorCode") }
    }

    fun start() {
        if (scanning) return
        val adapter = this.adapter ?: return
        val scanner = adapter.bluetoothLeScanner ?: return
        scanning = true
        // issue #30: дефолтный скан — legacy-only + low-power → НЕ видит BLE-5 extended/periodic рекламу
        // (так рекламируется GS1) → сенсор не находился на Android, а legacy-помпа находилась. Явно включаем
        // видимость extended-рекламы + активный режим на экране поиска.
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .apply {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    setLegacy(false)   // отдавать И legacy, И extended рекламу (иначе только legacy)
                    if (adapter.isLeCodedPhySupported) setPhy(ScanSettings.PHY_LE_ALL_SUPPORTED)
                }
            }
            .build()
        // Фильтров нет: ищем и сенсор (FF30, extended), и помпу (RileyLink, legacy) — распознаёт каталог в ядре.
        Log.d(TAG, "scan start: LOW_LATENCY legacy=${Build.VERSION.SDK_INT < Build.VERSION_CODES.O} extended=${Build.VERSION.SDK_INT >= Build.VERSION_CODES.O}")
        scanner.startScan(emptyList<ScanFilter>(), settings, callback)
    }
    fun stop() {
        if (!scanning) return
        scanning = false
        adapter?.bluetoothLeScanner?.stopScan(callback)
    }
}
