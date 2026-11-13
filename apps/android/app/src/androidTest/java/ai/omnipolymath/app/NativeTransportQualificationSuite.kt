package ai.omnipolymath.app

import ai.omnipolymath.app.gateway.CloudflareAccessNativeTest
import ai.omnipolymath.app.gateway.GatewaySessionTlsNativeTest
import ai.omnipolymath.app.ui.chat.ChatInlineWidgetTlsNativeTest
import org.junit.runner.RunWith
import org.junit.runners.Suite

// AGP 9.4's engine serializes runner arguments as CSV, truncating comma-separated class values.
// A standard single-class suite preserves every child test without changing its assertions.
@RunWith(Suite::class)
@Suite.SuiteClasses(
  CloudflareAccessNativeTest::class,
  GatewaySessionTlsNativeTest::class,
  ChatInlineWidgetTlsNativeTest::class,
)
class NativeTransportQualificationSuite
