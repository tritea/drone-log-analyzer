import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './styles/main.scss'
import App from './App.vue'
import '@/profiles' 


const app = createApp(App)
app.use(createPinia())
app.mount('#app')
