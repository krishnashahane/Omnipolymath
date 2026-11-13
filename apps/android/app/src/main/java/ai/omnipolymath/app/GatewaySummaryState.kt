package ai.omnipolymath.app

import ai.omnipolymath.app.i18n.NativeText

data class GatewaySummaryState<T>(
  val summary: T? = null,
  val refreshing: Boolean = false,
  val errorText: NativeText? = null,
)
