package com.pilgrim.narrowway

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebView
import com.revenuecat.purchases.CustomerInfo
import com.revenuecat.purchases.Offering
import com.revenuecat.purchases.Package
import com.revenuecat.purchases.PackageType
import com.revenuecat.purchases.PurchaseParams
import com.revenuecat.purchases.Purchases
import com.revenuecat.purchases.PurchasesConfiguration
import com.revenuecat.purchases.getCustomerInfoWith
import com.revenuecat.purchases.getOfferingsWith
import com.revenuecat.purchases.interfaces.UpdatedCustomerInfoListener
import com.revenuecat.purchases.purchaseWith
import com.revenuecat.purchases.restorePurchasesWith
import org.json.JSONObject

/**
 * Purchases through RevenueCat (src/core/Entitlement.ts, DECISIONS #402). Chapters I-IV are free; the RevenueCat
 * entitlement `full` unlocks the rest. The current offering holds three packages: Monthly and Annual (Google
 * Play subscription base plans with a free trial offer) and Lifetime (a one-time product). The game asks for
 * state with `billingState()` and is told of every change through `window.__pilgrimNative.billing(json)`:
 * whether the journey is owned, and each plan's store-formatted price and trial. RevenueCat validates and
 * acknowledges purchases; the game never sees a token. Status: "nokey" (no API key in res/values/revenuecat.xml:
 * nothing is sold), "connecting", "ready", "offline" (the store cannot be reached: the game keeps the last
 * confirmed purchase).
 */
class BillingBridge(private val activity: Activity, private val webView: WebView) {
    private val apiKey = activity.getString(R.string.revenuecat_api_key).trim()
    private var offering: Offering? = null
    @Volatile private var owned = false
    @Volatile private var ownedKind = ""
    @Volatile private var manageUrl: String? = null
    @Volatile private var status = if (apiKey.isEmpty()) "nokey" else "connecting"
    /** True once RevenueCat has answered about this player's purchases (not just a remembered guess). */
    @Volatile private var confirmed = false

    fun start() {
        if (apiKey.isEmpty()) return
        Purchases.configure(PurchasesConfiguration.Builder(activity.applicationContext, apiKey).build())
        Purchases.sharedInstance.updatedCustomerInfoListener = UpdatedCustomerInfoListener { apply(it, null) }
        Purchases.sharedInstance.getOfferingsWith(
            onError = { status = "offline"; push() },
            onSuccess = { offerings ->
                offering = offerings.current
                status = "ready"
                push()
            },
        )
        refreshPurchases()
    }

    fun refreshPurchases() {
        if (apiKey.isEmpty() || !Purchases.isConfigured) return
        Purchases.sharedInstance.getCustomerInfoWith(onError = { push() }, onSuccess = { apply(it, null) })
    }

    private fun apply(info: CustomerInfo, event: String?) {
        val full = info.entitlements[ENTITLEMENT]
        owned = full?.isActive == true
        ownedKind = when {
            !owned -> ""
            full?.expirationDate == null -> "lifetime"
            else -> "subscription"
        }
        manageUrl = info.managementURL?.toString()
        confirmed = true
        push(event)
    }

    // ---------------------------------------------------------------------------------------------- the game

    @JavascriptInterface
    fun billingState(): String = state(null).toString()

    /** plan: "monthly" | "yearly" | "lifetime". Opens Google Play's own purchase sheet. */
    @JavascriptInterface
    fun buy(plan: String) {
        activity.runOnUiThread {
            val pkg = packageFor(plan)
            if (pkg == null || !Purchases.isConfigured) {
                push("error")
                return@runOnUiThread
            }
            Purchases.sharedInstance.purchaseWith(
                PurchaseParams.Builder(activity, pkg).build(),
                onError = { _, cancelled -> push(if (cancelled) "cancelled" else "error") },
                onSuccess = { _, info -> apply(info, "purchased") },
            )
        }
    }

    @JavascriptInterface
    fun restore() {
        if (!Purchases.isConfigured) return
        Purchases.sharedInstance.restorePurchasesWith(onError = { push("error") }, onSuccess = { apply(it, "restored") })
    }

    /** Google Play's subscription page for this game (cancel, change plan). */
    @JavascriptInterface
    fun manageSubscription() {
        val url = manageUrl
            ?: "https://play.google.com/store/account/subscriptions?package=${activity.packageName.removeSuffix(".debug")}"
        activity.runOnUiThread { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }

    fun dispose() {
        if (Purchases.isConfigured) Purchases.sharedInstance.updatedCustomerInfoListener = null
    }

    // ------------------------------------------------------------------------------------------- internals

    private fun packageFor(plan: String): Package? {
        val o = offering ?: return null
        return when (plan) {
            "monthly" -> o.monthly ?: o.availablePackages.firstOrNull { it.packageType == PackageType.MONTHLY }
            "yearly" -> o.annual ?: o.availablePackages.firstOrNull { it.packageType == PackageType.ANNUAL }
            "lifetime" -> o.lifetime ?: o.availablePackages.firstOrNull { it.packageType == PackageType.LIFETIME }
            else -> null
        }
    }

    private fun planJson(plan: String): JSONObject? {
        val product = packageFor(plan)?.product ?: return null
        val trial = product.defaultOption?.freePhase?.billingPeriod?.iso8601 ?: ""
        return JSONObject()
            .put("price", product.price.formatted)
            .put("period", product.period?.iso8601 ?: "")
            .put("trial", trial)
    }

    private fun state(event: String?): JSONObject {
        val products = JSONObject()
        for (plan in listOf("monthly", "yearly", "lifetime")) planJson(plan)?.let { products.put(plan, it) }
        return JSONObject()
            .put("status", status)
            .put("owned", owned)
            .put("confirmed", confirmed)
            .put("kind", ownedKind)
            .put("event", event ?: "")
            .put("products", products)
    }

    private fun push(event: String? = null) {
        val json = JSONObject.quote(state(event).toString())
        webView.post { webView.evaluateJavascript("window.__pilgrimNative&&window.__pilgrimNative.billing&&window.__pilgrimNative.billing($json)", null) }
    }

    private companion object {
        /** The RevenueCat entitlement every package grants. */
        const val ENTITLEMENT = "full"
    }
}
