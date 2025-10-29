/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 主色调 - 神秘紫色系
        primary: {
          DEFAULT: '#8B5CF6',
          light: '#A78BFA',
          dark: '#6D28D9',
        },
        // 副色调 - 粉紫渐变
        secondary: {
          DEFAULT: '#EC4899',
          light: '#F472B6',
          dark: '#DB2777',
        },
        // 金色 - 神秘学元素
        mystic: {
          gold: '#FFD700',
          'gold-light': '#FFF4A3',
          'gold-dark': '#B8860B',
        },
        // 星空色
        cosmic: {
          blue: '#1E3A8A',
          purple: '#4C1D95',
          indigo: '#312E81',
        },
        // 深色主题
        dark: {
          bg: '#0A0A0F',
          surface: '#13131A',
          elevated: '#1A1A25',
          hover: '#232330',
          border: '#2D2D3D',
        }
      },
      backgroundImage: {
        'cosmic-gradient': 'linear-gradient(135deg, #0A0A0F 0%, #1E1B4B 50%, #4C1D95 100%)',
        'mystic-gradient': 'linear-gradient(135deg, #6D28D9 0%, #8B5CF6 50%, #EC4899 100%)',
        'gold-gradient': 'linear-gradient(135deg, #B8860B 0%, #FFD700 50%, #FFF4A3 100%)',
        'card-gradient': 'linear-gradient(180deg, rgba(139, 92, 246, 0.1) 0%, rgba(236, 72, 153, 0.1) 100%)',
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
          '0%, 100%': { boxShadow: '0 0 20px rgba(139, 92, 246, 0.5)' },
          '50%': { boxShadow: '0 0 40px rgba(236, 72, 153, 0.8)' },
        },
      },
      boxShadow: {
        'mystic': '0 0 30px rgba(139, 92, 246, 0.3)',
        'gold': '0 0 20px rgba(255, 215, 0, 0.4)',
        'cosmic': '0 10px 50px rgba(76, 29, 149, 0.5)',
      },
      fontFamily: {
        'display': ['Georgia', 'serif'],
        'mystic': ['Cinzel', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}




