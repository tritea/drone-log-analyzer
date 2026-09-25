import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/main.scss'
import App from './App.vue'
import '@/profiles'
import { i18n, tr } from '@/locales'

const app = createApp(App)
app.use(createPinia())
app.use(i18n)
// index.html 里的静态 lang/title 只是 JS 前兜底，这里按实际 locale 覆盖
document.documentElement.lang = i18n.global.locale.value
document.title = tr('common.app.title')
app.mount('#app')
