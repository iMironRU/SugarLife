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
import android.bluetooth.le.ScanResult
import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import ru.imiron.sugarlife.drivers.medtronic.PumpTransportBridge
import ru.imiron.sugarlife.drivers.sibionics.SensorTransportBridge
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue

/** Нативный Android BLE — зеркало Swift `SugarLifeBleBridges.swift` (логика из проверенного спайка).
 *  Домен/протоколы (Sibionics AA55, Medtronic) остаются в KMP; здесь только транспорт (CoreBluetooth ↔ BluetoothGatt). */

private fun uuid16(v: String): UUID = UUID.fromString("0000$v-0000-1000-8000-00805f9b34fb")
private val CCCD = uuid16("2902")

/** Короткая форма стандартного Bluetooth-UUID (как CBUUID на iOS): 0000FF30-0000-1000-8000-00805f9b34fb → "FF30".
 *  Каталог матчит короткие ("FF30"); Android же отдаёт полный 128-битный → без нормализации совпадения нет.
 *  Кастомные 128-битные (RileyLink) остаются полными. */
private fun shortUuid(u: UUID): String {
    val s = u.toString().lowercase()
    return if (s.startsWith("0000") && s.endsWith("-0000-1000-8000-00805f9b34fb"))
        s.substring(4, 8).uppercase() else s.uppercase()
}
private val mainHandler = Handler(Looper.getMainLooper())

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
    @Synchronized private fun enqueue(op: () -> Unit) { opQueue.add(op); pump() }
    @Synchronized private fun opDone() { opBusy = false; pump() }
    @Synchronized private fun pump() {
        if (opBusy) return
        val op = opQueue.poll() ?: return
        opBusy = true
        op()
    }

    fun subscribe(char: UUID, handler: (ByteArray) -> Unit) { notifyHandlers[char] = handler }

    fun connect() {
        // Свежая GATT-сессия (реконнект): сбрасываем состояние старой, иначе застрявшая операция/характеристика мешает.
        chars.clear(); readHandlers.clear(); opQueue.clear(); opBusy = false
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
        val device = adapter.getRemoteDevice(address)
        onState?.invoke("Connecting")
        gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
    }

    fun disconnect() {
        gatt?.disconnect(); gatt?.close(); gatt = null
    }

    fun write(char: UUID, bytes: ByteArray) = enqueue {
        val g = gatt; val c = chars[char]
        if (g == null || c == null) { opDone(); return@enqueue }
        c.writeType = if (c.properties and BluetoothGattCharacteristic.PROPERTY_WRITE != 0)
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        else BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        c.value = bytes
        g.writeCharacteristic(c)
    }

    fun read(char: UUID, completion: (ByteArray?) -> Unit) = enqueue {
        val g = gatt; val c = chars[char]
        if (g == null || c == null) { completion(null); opDone(); return@enqueue }
        readHandlers[char] = completion
        g.readCharacteristic(c)
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
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
    private val link = BleLink(context, bleId, notifyChars = setOf(RL_RESP))
    private var pending: ((ByteArray) -> Unit)? = null

    override fun onLink(callback: (String) -> Unit) { link.onState = callback }
    override fun connect() {
        // Ответ приходит нотификацией respCount → читаем data → отдаём ожидающему.
        link.subscribe(RL_RESP) {
            link.read(RL_DATA) { data ->
                val cb = pending; pending = null
                if (data != null && cb != null) cb(data)
            }
        }
        link.connect()
    }
    override fun command(bytes: ByteArray, timeoutMs: Long, callback: (ByteArray) -> Unit) {
        pending = callback
        link.write(RL_DATA, bytes)
    }
    override fun disconnect() = link.disconnect()
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
            onAdvertisement(dto.toString())
        }
    }

    fun start() {
        if (scanning) return
        val scanner = adapter?.bluetoothLeScanner ?: return
        scanning = true
        scanner.startScan(callback)   // без фильтров — распознавание по каталогу в ядре (как iOS фильтр на будущее)
    }
    fun stop() {
        if (!scanning) return
        scanning = false
        adapter?.bluetoothLeScanner?.stopScan(callback)
    }
}
