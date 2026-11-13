package ai.omnipolymath.app.protocol

import org.junit.Assert.assertTrue
import org.junit.Test

class OmnipolymathProtocolConstantsTest {
  @Test
  fun generatedCapabilitiesAreUniqueProtocolIds() {
    val values = OmnipolymathCapability.entries.map { it.rawValue }

    assertTrue(values.isNotEmpty())
    assertTrue(values.all { it.isNotBlank() && "." !in it })
    assertTrue(values.size == values.toSet().size)
  }

  @Test
  fun generatedCommandGroupsMatchTheirNamespaces() {
    val groups =
      listOf(
        OmnipolymathCameraCommand.NamespacePrefix to OmnipolymathCameraCommand.entries.map { it.rawValue },
        OmnipolymathSmsCommand.NamespacePrefix to OmnipolymathSmsCommand.entries.map { it.rawValue },
        OmnipolymathTalkCommand.NamespacePrefix to OmnipolymathTalkCommand.entries.map { it.rawValue },
        OmnipolymathLocationCommand.NamespacePrefix to OmnipolymathLocationCommand.entries.map { it.rawValue },
        OmnipolymathDeviceCommand.NamespacePrefix to OmnipolymathDeviceCommand.entries.map { it.rawValue },
        OmnipolymathNotificationsCommand.NamespacePrefix to OmnipolymathNotificationsCommand.entries.map { it.rawValue },
        OmnipolymathSystemCommand.NamespacePrefix to OmnipolymathSystemCommand.entries.map { it.rawValue },
        OmnipolymathPhotosCommand.NamespacePrefix to OmnipolymathPhotosCommand.entries.map { it.rawValue },
        OmnipolymathContactsCommand.NamespacePrefix to OmnipolymathContactsCommand.entries.map { it.rawValue },
        OmnipolymathCalendarCommand.NamespacePrefix to OmnipolymathCalendarCommand.entries.map { it.rawValue },
        OmnipolymathMotionCommand.NamespacePrefix to OmnipolymathMotionCommand.entries.map { it.rawValue },
        OmnipolymathCallLogCommand.NamespacePrefix to OmnipolymathCallLogCommand.entries.map { it.rawValue },
      )

    val commands = groups.flatMap { (prefix, values) -> values.onEach { assertTrue(it.startsWith(prefix)) } }
    assertTrue(commands.size == commands.toSet().size)
  }
}
