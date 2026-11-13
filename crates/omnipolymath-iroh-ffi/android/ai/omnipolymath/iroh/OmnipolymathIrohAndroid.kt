package ai.omnipolymath.iroh

import android.content.Context

/** Call from Application.onCreate before any endpoint is bound. */
object OmnipolymathIrohAndroid {
    init { System.loadLibrary("omnipolymath_iroh_ffi") }

    fun install(context: Context) = installNative(context.applicationContext)

    @JvmStatic private external fun installNative(application: Context)
}
