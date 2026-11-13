package ai.omnipolymath.app.gateway

import org.junit.Assert.assertEquals
import org.junit.Test

class BonjourEscapesTest {
  @Test
  fun decodeNoop() {
    assertEquals("", BonjourEscapes.decode(""))
    assertEquals("hello", BonjourEscapes.decode("hello"))
  }

  @Test
  fun decodeDecodesDecimalEscapes() {
    assertEquals("Omnipolymath Gateway", BonjourEscapes.decode("Omnipolymath\\032Gateway"))
    assertEquals("A B", BonjourEscapes.decode("A\\032B"))
    assertEquals("Krishna\u2019s Mac", BonjourEscapes.decode("Krishna\\226\\128\\153s Mac"))
  }
}
