/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx}',
  ],
  // 主题 class 由运行时根据设置拼接到 <html>，Tailwind 无法从 TSX 静态扫描到。
  // 必须 safelist，否则 @layer base 中对应的 CSS 变量块会在构建时被裁掉。
  safelist: [
    'theme-ocean-light',
    'theme-ocean-dark',
    'theme-forest-light',
    'theme-forest-dark',
    'theme-slate-light',
    'theme-slate-dark',
    'theme-terminal-dark',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        dialog: {
          DEFAULT: 'hsl(var(--dialog))',
          foreground: 'hsl(var(--dialog-foreground))',
        },
        tooltip: {
          DEFAULT: 'hsl(var(--tooltip) / <alpha-value>)',
          foreground: 'hsl(var(--tooltip-foreground) / <alpha-value>)',
          muted: 'hsl(var(--tooltip-muted) / <alpha-value>)',
        },
        'content-area': 'hsl(var(--content-area) / <alpha-value>)',
        // CraftBuddy 品牌色板（Claude 暖色系，暗色工程工具版）
        'craft-accent': {
          DEFAULT: '#DA7756',
          dim: 'rgba(218, 119, 86, 0.12)',
        },
        'craft-success': '#10b981',
        'craft-warning': '#f59e0b',
      },
      // ===== 字体栈：Inter Variable 优先，回退 SF Pro Text / 系统中文字体 =====
      fontFamily: {
        sans: [
          'Geist Variable',
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'PingFang SC',
          'Segoe UI',
          'Microsoft YaHei',
          'system-ui',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Cascadia Code',
          'Consolas',
          'Courier New',
          'monospace',
        ],
      },
      // ===== 圆角：覆写 shadcn 标准三档，全部由 --radius 派生 =====
      // 改一处 --radius 即可整站统一调圆角节奏，无需 grep 替换 300+ 处 rounded-*
      borderRadius: {
        sm: 'calc(var(--radius) - 4px)',
        DEFAULT: 'calc(var(--radius) - 2px)',
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + var(--radius-xl-extra, 2px))',
        '2xl': 'calc(var(--radius) + var(--radius-2xl-extra, 4px))',
      },
      // ===== Motion token（唯一出处 globals.css :root）=====
      // duration-fast/base/slow + ease-out/in-out；tailwindcss-animate 会让
      // duration-* / ease-* 同时作用于 animation-*，因此 animate-in 一并生效。
      // 注意：这里覆写了内置 ease-out —— 全站入场曲线统一为 expo-out。
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
      },
      // ===== 阴影：覆写 Tailwind 内置的 sm/md/lg/xl/DEFAULT =====
      // 现有 78 处 shadow-md / shadow-lg 等代码无需改动，自动吃多层柔阴影 + 主题自适应
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        '2xl': 'var(--shadow-xl)',
      },
      keyframes: {
        'slide-in-from-top': {
          from: { transform: 'translateY(-100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-in-from-bottom': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-out-to-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        'preview-slide-out': {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(100%)' },
        },
      },
      animation: {
        'in': 'slide-in-from-top 0.3s ease-out',
        'out': 'slide-out-to-right 0.2s ease-in',
        'preview-slide-out': 'preview-slide-out 0.25s ease-out forwards',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
}
