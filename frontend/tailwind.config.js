/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 主色调 — 古铜金 (神谕之声 · 暖)
        primary: {
          DEFAULT: '#C9A96E',
          light: '#F0D090',
          dark: '#8A6D3B',
        },
        // 副色调 — 月光银蓝 (问卜之人 · 冷)
        secondary: {
          DEFAULT: '#A8D8EA',
          light: '#C9E8F5',
          dark: '#6E9DB5',
        },
        // 古铜金 — 神秘学元素
        mystic: {
          gold: '#C9A96E',
          'gold-light': '#F0D090',
          'gold-dark': '#8A6D3B',
        },
        // 星象色
        cosmic: {
          blue: '#A8D8EA',
          gold: '#C9A96E',
          ink: '#06060F',
        },
        // 近黑虚空主题
        dark: {
          bg: '#06060F',
          surface: '#0B0B16',
          elevated: '#12121E',
          hover: '#1A1A28',
          border: '#232334',
        }
      },
      backgroundImage: {
        'cosmic-gradient': 'radial-gradient(ellipse at 50% 30%, #0E0E1C 0%, #08080F 55%, #040409 100%)',
        'mystic-gradient': 'linear-gradient(135deg, #8A6D3B 0%, #C9A96E 50%, #F0D090 100%)',
        'gold-gradient': 'linear-gradient(135deg, #8A6D3B 0%, #C9A96E 45%, #F0D090 100%)',
        'card-gradient': 'linear-gradient(180deg, rgba(201, 169, 110, 0.08) 0%, rgba(168, 216, 234, 0.06) 100%)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'slide-down': 'slideDown 0.5s ease-out',
        'float': 'float 3s ease-in-out infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'twinkle': 'twinkle 2s ease-in-out infinite',
        'rotate-slow': 'rotate 20s linear infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'glow': 'glow 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        twinkle: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.3', transform: 'scale(0.8)' },
        },
        rotate: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-1000px 0' },
          '100%': { backgroundPosition: '1000px 0' },
        },
        glow: {
          '0%, 100%': { boxShadow: '0 0 18px rgba(201, 169, 110, 0.22)' },
          '50%': { boxShadow: '0 0 36px rgba(201, 169, 110, 0.45)' },
        },
      },
      boxShadow: {
        'mystic': '0 0 30px rgba(201, 169, 110, 0.18)',
        'gold': '0 0 24px rgba(201, 169, 110, 0.32)',
        'cosmic': '0 24px 60px rgba(0, 0, 0, 0.6)',
        'moon': '0 0 24px rgba(168, 216, 234, 0.22)',
      },
      fontFamily: {
        'display': ['Cinzel', 'Noto Serif SC', 'serif'],
        'mystic': ['Cinzel', 'Noto Serif SC', 'serif'],
        'serif-cn': ['Noto Serif SC', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}




