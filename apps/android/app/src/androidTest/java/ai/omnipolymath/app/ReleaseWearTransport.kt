package ai.omnipolymath.app

import ai.omnipolymath.app.wear.WearMessageSender
import ai.omnipolymath.app.wear.WearPeerResolver
import ai.omnipolymath.app.wear.WearProxyBridge
import ai.omnipolymath.releasevalidation.LocalWearTransport
import ai.omnipolymath.wear.shared.WearProtocol

internal fun attachReleaseWearTransport(app: NodeApp): LocalWearTransport {
  val bridge = app.wearProxyBridge
  val senderField = WearProxyBridge::class.java.getDeclaredField("sender").apply { isAccessible = true }
  val resolverField = WearProxyBridge::class.java.getDeclaredField("peerResolver").apply { isAccessible = true }
  val previousSender = senderField.get(bridge)
  val previousResolver = resolverField.get(bridge)
  val transport =
    LocalWearTransport(
      role = "phone",
      nodeId = "release-phone",
      peerNodeId = "release-wear",
      socketName = "omnipolymath-release-phone",
      receive = { source, path, bytes ->
        check(path == WearProtocol.REQUEST_PATH)
        check(bridge.handleMessage(source, bytes)) { "Phone bridge did not deliver response" }
      },
      restore = {
        senderField.set(bridge, previousSender)
        resolverField.set(bridge, previousResolver)
      },
    )
  // Retain the process-owned bridge and its real NodeRuntime controller/event forwarding.
  senderField.set(bridge, WearMessageSender { target, path, bytes -> transport.send(target, path, bytes) })
  resolverField.set(bridge, WearPeerResolver { transport.reachablePeerNodeId()?.let(::setOf).orEmpty() })
  return transport.start()
}
