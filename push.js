// SPS Push Notifications — client helper
// Registers service worker, subscribes to push, stores subscription in Supabase

const SPS_VAPID_PUBLIC_KEY = 'BPTATssbe3S9N6d6xRvPDL4ZxhD3rPlVgGl4NoY3EFtd4LFqj3r7-Z1zfEzhnPySOUd0vYqI-bByudG0O_MWFGU'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

// Call this after login with the user's identity
// userType: 'teacher' | 'admin', userId: teacher_id or admin_id
async function initPushNotifications(sb, userType, userId) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('[Push] Not supported on this browser')
    return
  }
  try {
    const reg = await navigator.serviceWorker.register('sw.js')
    console.log('[Push] Service worker registered')

    // Wait for it to be ready
    await navigator.serviceWorker.ready

    // Check existing permission
    if (Notification.permission === 'denied') {
      console.log('[Push] Permission denied by user')
      return
    }

    // Request permission if needed
    let perm = Notification.permission
    if (perm === 'default') {
      perm = await Notification.requestPermission()
    }
    if (perm !== 'granted') {
      console.log('[Push] Permission not granted')
      return
    }

    // Subscribe to push
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(SPS_VAPID_PUBLIC_KEY)
      })
      console.log('[Push] New subscription created')
    }

    // Store subscription in Supabase (upsert by endpoint)
    const subJson = sub.toJSON()
    const { error } = await sb.from('push_subscriptions').upsert({
      user_type: userType,
      user_id: userId,
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth,
      updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' })

    if (error) console.warn('[Push] Failed to store subscription:', error.message)
    else console.log('[Push] Subscription saved for', userType, userId)

  } catch (e) {
    console.warn('[Push] Setup failed:', e.message)
  }
}

// Optional: unsubscribe (on logout)
async function disablePushNotifications(sb) {
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await sb.from('push_subscriptions').delete().eq('endpoint', sub.toJSON().endpoint)
      await sub.unsubscribe()
      console.log('[Push] Unsubscribed')
    }
  } catch (e) {
    console.warn('[Push] Unsubscribe failed:', e.message)
  }
}
