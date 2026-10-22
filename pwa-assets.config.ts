import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.3, resizeOptions: { background: '#07060D' } },
    apple: { ...minimal2023Preset.apple, padding: 0.3, resizeOptions: { background: '#07060D' } },
  },
  images: ['public/logo.svg'],
})
