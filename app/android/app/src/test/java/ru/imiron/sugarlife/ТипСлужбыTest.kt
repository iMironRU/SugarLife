package ru.imiron.sugarlife

import android.content.pm.ServiceInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * ОПЕКУН НЕ ДОЛЖЕН ВЫКЛЮЧАТЬСЯ ЧЕРЕЗ ШЕСТЬ ЧАСОВ (SugarLifeCore#216).
 *
 * У того, кто смотрит за ребёнком или за родителем по интернету, приборов нет и не будет. Ему
 * оставался `dataSync` с потолком в шесть часов в сутки — то есть наблюдение выключалось системой
 * под утро, ровно когда нужнее всего.
 */
class ТипСлужбыTest {

    private val прибором = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    private val медиа = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    private val синхро = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC

    @Test
    fun опекун_с_опорой_уходит_от_потолка_в_шесть_часов() {
        val тип = ТипСлужбы.выбрать(прибор = false, медиа = true)
        assertTrue("опекуну не объявили медиа: ${ТипСлужбы.словами(тип)}", тип and медиа != 0)
        assertEquals(
            "к медиа примешали dataSync — его потолок в шесть часов приедет вместе с ним",
            0, тип and синхро,
        )
    }

    @Test
    fun опекун_без_опоры_остаётся_на_синхронизации() {
        /* Опора выключена человеком — врать про плеер нельзя. Живём с потолком и честно. */
        assertEquals(синхро, ТипСлужбы.выбрать(прибор = false, медиа = false))
    }

    @Test
    fun с_прибором_объявляем_прибор() {
        val тип = ТипСлужбы.выбрать(прибор = true, медиа = false)
        assertEquals(прибором, тип)
        assertEquals("dataSync притащил бы свой потолок", 0, тип and синхро)
    }

    @Test
    fun и_прибор_и_плеер_объявляем_оба() {
        val тип = ТипСлужбы.выбрать(прибор = true, медиа = true)
        assertTrue(тип and прибором != 0)
        assertTrue(тип and медиа != 0)
        assertEquals(0, тип and синхро)
    }

    @Test
    fun пустых_обещаний_системе_не_даём() {
        /* Ровно то, за что нас, судя по журналу, убили на песочнице: служба объявляла подключённый
           прибор при выключенном Bluetooth. Ни один тип не должен появляться без своего факта. */
        val ничего = ТипСлужбы.выбрать(прибор = false, медиа = false)
        assertEquals("объявили прибор, которого нет", 0, ничего and прибором)
        assertEquals("объявили плеер, которого нет", 0, ничего and медиа)
    }

    @Test
    fun словами_читает_человек_а_не_машина() {
        assertTrue("mediaPlayback" in ТипСлужбы.словами(ТипСлужбы.выбрать(false, true)))
        assertTrue("6ч/сут" in ТипСлужбы.словами(ТипСлужбы.выбрать(false, false)))
    }
}
