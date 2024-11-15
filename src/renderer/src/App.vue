<script setup>
import { onMounted } from 'vue'
import Versions from './components/Versions.vue'

onMounted(() => {
  console.log('渲染进程已挂载！')
  console.log(window.electron.ipcRenderer)
  window.electron.ipcRenderer.on('auth-success', (event, token) => {
    console.log('渲染进程拿到了Received Access Token in renderer:', token) // 确认接收到 token
  })
})
const handleAuthorize = () => {
  // 请求主进程启动 Spotify OAuth 流程
  window.electron.ipcRenderer.send('authorize-spotify')
}

const handlePlayPause = async () => {
  // 从主进程获取 OAuth 令牌
  const token = await window.api.getAccessToken()
  if (!token) {
    alert('请先完成 Spotify 授权！')
    return
  }

  // 使用令牌发送播放/暂停请求
  fetch('https://api.spotify.com/v1/me/player/play', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
    .then((response) => {
      if (response.ok) {
        alert('播放/暂停命令发送成功！')
      } else {
        console.error('播放/暂停失败:', response.statusText)
      }
    })
    .catch((error) => {
      console.error('网络错误:', error)
    })
}
</script>

<template>
  <img alt="logo" class="logo" src="./assets/electron.svg" />
  <div class="creator">Powered by electron-vite</div>
  <div class="text">
    Build an Electron app with
    <span class="vue">Vue</span>
  </div>
  <p class="tip">Please try pressing <code>F12</code> to open the devTool</p>
  <div class="actions">
    <div class="action">
      <button @click="handleAuthorize">Authorize Spotify</button>
    </div>
    <div class="action">
      <button @click="handlePlayPause">Play/Pause Spotify</button>
    </div>
  </div>
  <Versions />
</template>
