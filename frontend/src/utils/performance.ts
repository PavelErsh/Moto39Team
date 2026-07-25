/**
 * Детекция "слабого" устройства и включение lite-режима.
 *
 * Ставим класс `low-end` на <html>, чтобы CSS мог отключить дорогие эффекты
 * (сканлайны, виньетку, backdrop-filter, крупные тени/свечения и hover-
 * трансформы). См. соответствующие правила в src/index.css.
 *
 * Критерии слабого устройства (срабатывает любой):
 *   1. navigator.hardwareConcurrency <= 4 (мало ядер CPU).
 *   2. navigator.deviceMemory <= 4 (мало ОЗУ, Chrome/Chromium).
 *   3. prefers-reduced-motion: reduce (пользователь сам попросил меньше движения).
 *   4. prefers-reduced-transparency: reduce.
 *   5. Явный оверрайд: ?lite=1 в URL или localStorage.lowEnd === "1".
 *   6. Ширина экрана <= 380px (обычно очень старые/бюджетные телефоны).
 *
 * Оверрайд можно и выключить: ?lite=0 или localStorage.lowEnd === "0".
 */

type NavigatorWithDeviceMemory = Navigator & { deviceMemory?: number }

function readOverride(): boolean | null {
  try {
    const url = new URL(window.location.href)
    const q = url.searchParams.get('lite')
    if (q === '1') return true
    if (q === '0') return false
  } catch {
    /* noop */
  }
  try {
    const ls = window.localStorage.getItem('lowEnd')
    if (ls === '1') return true
    if (ls === '0') return false
  } catch {
    /* noop */
  }
  return null
}

export function isLowEndDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }

  const override = readOverride()
  if (override !== null) return override

  const nav = navigator as NavigatorWithDeviceMemory

  // 1. Мало ядер CPU
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0) {
    if (nav.hardwareConcurrency <= 4) return true
  }

  // 2. Мало памяти (Chrome/Chromium: deviceMemory в GB, ступени 0.25/0.5/1/2/4/8)
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0) {
    if (nav.deviceMemory <= 4) return true
  }

  // 3. Reduced motion / transparency
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
    if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) {
      return true
    }
  } catch {
    /* noop */
  }

  // 4. Очень узкие экраны — консервативно считаем «слабыми».
  if (typeof window.innerWidth === 'number' && window.innerWidth > 0) {
    if (window.innerWidth <= 380) return true
  }

  return false
}

/**
 * Применить класс `low-end` к <html>, если устройство определено как слабое.
 * Вызывается один раз при старте приложения.
 */
export function applyLowEndClass(): void {
  if (typeof document === 'undefined') return
  if (isLowEndDevice()) {
    document.documentElement.classList.add('low-end')
  } else {
    document.documentElement.classList.remove('low-end')
  }
}
