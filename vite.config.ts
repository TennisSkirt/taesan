import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // GitHub Pages: https://tennisskirt.github.io/taesan/
  base: '/taesan/',
  build: {
    outDir: 'docs', // Pages "main 브랜치 /docs" 배포 방식
  },
  server: {
    fs: {
      // 프로젝트 경로의 한글(NFC/NFD) 정규화 불일치로 @fs 접근이 403이 되는 문제 회피
      strict: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // 폰트(웹폰트 2MB + 아이콘 5.3MB)까지 오프라인 캐시에 포함
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      manifest: {
        name: '태산',
        short_name: '태산',
        description: '티끌 모아 태산 — 주식 수익률·배당·세금까지 한눈에 보는 자산관리 앱',
        lang: 'ko',
        theme_color: '#f4f3f1',
        background_color: '#f4f3f1',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
