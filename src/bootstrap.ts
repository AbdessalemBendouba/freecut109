// Chrome 109 ES2023/ES2024 Polyfills
if (!(Array.prototype as any).toSorted) {
  ;(Array.prototype as any).toSorted = function (compareFn?: (a: any, b: any) => number) {
    return [...this].sort(compareFn)
  }
}
if (!(Array.prototype as any).toReversed) {
  ;(Array.prototype as any).toReversed = function () {
    return [...this].reverse()
  }
}
if (!(Array.prototype as any).toSpliced) {
  ;(Array.prototype as any).toSpliced = function (
    start: number,
    deleteCount?: number,
    ...items: any[]
  ) {
    const copy = [...this]
    copy.splice(start, deleteCount === undefined ? copy.length - start : deleteCount, ...items)
    return copy
  }
}
if (!(Array.prototype as any).with) {
  ;(Array.prototype as any).with = function (index: number, value: any) {
    const copy = [...this]
    copy[index] = value
    return copy
  }
}
if (!Promise.withResolvers) {
  ;(Promise as any).withResolvers = function () {
    let resolve: (value: unknown) => void, reject: (reason?: unknown) => void
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve: resolve!, reject: reject! }
  }
}
if (!Object.hasOwn) {
  Object.hasOwn = function (obj: object, prop: PropertyKey) {
    return Object.prototype.hasOwnProperty.call(obj, prop)
  }
}

const APP_SHELL_CACHE_PREFIX = 'freecut-app-shell-'

async function removeProductionAppShellFromDevelopment(): Promise<boolean> {
  if (!import.meta.env.DEV) return false

  const wasControlled = 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(
      registrations
        .filter((registration) => registration.scope.startsWith(window.location.origin))
        .map((registration) => registration.unregister()),
    )
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(APP_SHELL_CACHE_PREFIX))
        .map((cacheName) => caches.delete(cacheName)),
    )
  }

  return wasControlled
}

void removeProductionAppShellFromDevelopment()
  .then((requiresReload) => {
    if (requiresReload) {
      window.location.reload()
      return
    }
    return import('./main')
  })
  .catch(() => import('./main'))
