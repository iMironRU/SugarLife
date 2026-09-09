package ru.imiron.sugarlife

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Правила подъёма после смерти (SugarLifeCore#227). */
class ВоскрешениеTest {

    @Test fun `выключенный мониторинг не воскрешаем`() {
        assertFalse("выключил человек — значит выключил", Воскрешение.ставитьЛи(false))
        assertFalse(Воскрешение.поднимать(мониторингВключён = false, службаЖива = false))
    }

    @Test fun `включённый мониторинг проверяем`() {
        assertTrue(Воскрешение.ставитьЛи(true))
    }

    @Test fun `живую службу не трогаем`() {
        assertFalse(
            "лишний startForegroundService по живой службе стоит переподключения прибора",
            Воскрешение.поднимать(мониторингВключён = true, службаЖива = true),
        )
    }

    @Test fun `мёртвую поднимаем`() {
        assertTrue(Воскрешение.поднимать(мониторингВключён = true, службаЖива = false))
    }

    /**
     * Не «красивое число», а граница темноты: на телефоне владельца она была двенадцать часов.
     * Сенсор отдаёт показание раз в пять минут — за четверть часа теряется три подряд, не больше.
     */
    @Test fun `темнота не длиннее четверти часа`() {
        assertEquals(15L, Воскрешение.ЧЕРЕЗ_МС / 60_000)
    }
}
