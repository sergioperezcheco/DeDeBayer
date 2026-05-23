/**
 * 主题管理
 */

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'dedebayer-theme'

export function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return 'light' // 默认亮色
}

export function applyTheme(theme: Theme) {
  if (theme === 'dark') {
    document.body.classList.add('dark')
  } else {
    document.body.classList.remove('dark')
  }
  localStorage.setItem(STORAGE_KEY, theme)
}
