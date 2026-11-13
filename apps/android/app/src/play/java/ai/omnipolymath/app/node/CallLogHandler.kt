package ai.omnipolymath.app.node

import ai.omnipolymath.app.gateway.GatewaySession
import android.content.Context

class CallLogHandler(
  @Suppress("unused") appContext: Context,
) {
  fun handleCallLogSearch(
    @Suppress("unused") paramsJson: String?,
  ): GatewaySession.InvokeResult = nodeInvokeError("CALL_LOG_UNAVAILABLE", "call log not available on this build")
}
