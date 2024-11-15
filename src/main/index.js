import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  nativeImage,
  dialog,
  Menu
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon1 from '../../resources/icon.png?asset'
import play from '../../resources/icons/play.svg?asset'
import pause from '../../resources/icons/pause.svg?asset'
import previous from '../../resources/icons/previous.svg?asset'
import next from '../../resources/icons/next.svg?asset'
import express from 'express'
import { createRequire } from 'module'
import fs from 'fs'
import crypto from 'crypto'

const TOKEN_PATH = join(app.getPath('userData'), 'tokens.json')

let codeVerifier = crypto.randomBytes(64).toString('hex')
let codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

const require = createRequire(import.meta.url)

const { createCanvas, loadImage } = require('canvas')

console.log(createCanvas, loadImage)

let accessToken = null
let refreshToken = null
let tray = null

const EXPRESS_PORT = 8888 // Express 服务器端口

let isPlaying = false // 初始状态为未播放

const configPath = join(app.getPath('userData'), 'config.json')

function saveUserConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config))
}

function loadUserConfig() {
  if (fs.existsSync(configPath)) {
    const data = fs.readFileSync(configPath)
    return JSON.parse(data)
  }
  return {}
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens))
}

function loadTokens() {
  if (fs.existsSync(TOKEN_PATH)) {
    const data = fs.readFileSync(TOKEN_PATH)
    return JSON.parse(data)
  }
  return null
}

async function checkAccessTokenValidity() {
  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })
    return response.ok
  } catch (error) {
    console.error('检查令牌有效性时出错:', error)
    return false
  }
}

async function refreshAccessToken() {
  if (!refreshToken) {
    return false
  }

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: '630ac25f2b4241e980dfe5b825b24980'
      })
    })

    const data = await response.json()

    if (response.ok) {
      accessToken = data.access_token
      // 如果返回了新的refreshToken，更新它
      if (data.refresh_token) {
        refreshToken = data.refresh_token
      }
      saveTokens({ accessToken, refreshToken })
      return true
    } else {
      console.error('刷新令牌失败:', data)
      return false
    }
  } catch (error) {
    console.error('网络错误:', error)
    return false
  }
}

async function createTray() {
  const iconSize = 24
  const buttonWidth = 30
  const spacing = 5 // 设置按钮之间的间距
  const trayWidth = iconSize + buttonWidth * 3 + spacing * 3 // 调整 trayWidth，增加间距
  const canvas = createCanvas(trayWidth, iconSize)
  const ctx = canvas.getContext('2d')

  // 加载托盘主图标和按钮图标
  const iconImage = await loadImage(icon1)
  const playImage = await loadImage(play)
  const pauseImage = await loadImage(pause)
  const previousImage = await loadImage(previous)
  const nextImage = await loadImage(next)

  // 绘制托盘图标的函数，根据播放状态选择播放或暂停图标
  async function drawTrayIcon() {
    ctx.clearRect(0, 0, trayWidth, iconSize) // 清空画布

    ctx.drawImage(iconImage, 0, 2, 20, 20) // 绘制主图标

    // 根据播放状态选择播放或暂停图标，并增加间距
    const playPauseImage = isPlaying ? pauseImage : playImage
    ctx.drawImage(playPauseImage, iconSize + spacing, 0, buttonWidth, iconSize)
    ctx.drawImage(previousImage, iconSize + buttonWidth + spacing * 2, 0, buttonWidth, iconSize)
    ctx.drawImage(nextImage, iconSize + buttonWidth * 2 + spacing * 3, 0, buttonWidth, iconSize)

    const trayImage = nativeImage.createFromBuffer(canvas.toBuffer())
    tray.setImage(trayImage)
  }

  if (!tray) {
    // 如果托盘实例还未创建，初始化托盘
    tray = new Tray(nativeImage.createFromBuffer(canvas.toBuffer()))

    tray.on('click', async () => {
      const trayBounds = tray.getBounds()
      const buttonWidthWithSpacing = buttonWidth + spacing // 每个按钮宽度加上间距

      const { x: cursorX } = screen.getCursorScreenPoint()
      const clickX = cursorX - trayBounds.x

      // 判断点击区域，考虑间距
      if (clickX >= iconSize && clickX < iconSize + buttonWidth) {
        console.log('播放/暂停按钮点击')
        if (!accessToken) {
          await showAuthDialog()
          return
        }
        if (isPlaying) {
          await pauseCurrentTrack()
        } else {
          await playCurrentTrack()
        }
        isPlaying = !isPlaying // 切换播放状态
        await drawTrayIcon() // 重新绘制托盘图标
      } else if (
        clickX >= iconSize + buttonWidthWithSpacing &&
        clickX < iconSize + buttonWidthWithSpacing * 2
      ) {
        console.log('上一曲按钮点击')
        await playPreviousTrack()
      } else if (
        clickX >= iconSize + buttonWidthWithSpacing * 2 &&
        clickX < iconSize + buttonWidthWithSpacing * 3
      ) {
        console.log('下一曲按钮点击')
        await playNextTrack()
      }
    })

    const userConfig = loadUserConfig()
    console.log('开机自启动:', userConfig.autoLaunch)

    const contextMenu = Menu.buildFromTemplate([
      {
        label: '开机自启动',
        type: 'checkbox',
        checked: userConfig.autoLaunch,
        click: (menuItem) => {
          // 当用户点击时，更新开机自启动设置
          setAutoLaunch(menuItem.checked)
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.quit()
        }
      }
    ])

    tray.on('right-click', (event, bounds) => {
      console.log('右键点击', event, bounds)
      tray.popUpContextMenu(contextMenu)
    })
  }

  await drawTrayIcon() // 绘制托盘图标内容
}

function setAutoLaunch(enable) {
  // 保存用户配置
  const userConfig = loadUserConfig()
  userConfig.autoLaunch = enable
  saveUserConfig(userConfig)
}

async function showAuthDialog() {
  const result = await dialog.showMessageBox({
    type: 'warning',
    title: '未授权访问',
    message: '您尚未授权操作，是否现在进行授权？',
    buttons: ['取消', '去授权'],
    defaultId: 1, // 设置默认选中的按钮为 "去授权"
    cancelId: 0, // 设置取消按钮的 ID
    icon: nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')) // 可以设置一个图标
  })

  // 用户选择了 "去授权" 按钮
  if (result.response === 1) {
    // 重新生成codeVerifier和codeChallenge
    codeVerifier = crypto.randomBytes(64).toString('hex')
    codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    startOAuthFlow()
  } else {
    return false
  }
}

async function playCurrentTrack() {
  if (!accessToken) {
    await showAuthDialog()
    return
  }
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/play', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (response.ok) {
      console.log('播放成功')
    } else {
      const errorData = await response.json()
      console.error('播放失败:', errorData)
    }
  } catch (error) {
    console.error('网络错误:', error)
  }
}

async function pauseCurrentTrack() {
  if (!accessToken) {
    await showAuthDialog()
  }

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (response.ok) {
      console.log('当前播放的歌曲已暂停')
    } else {
      const errorData = await response.json()
      console.error('暂停失败:', errorData)
    }
  } catch (error) {
    console.error('网络错误:', error)
  }
}

async function playPreviousTrack() {
  if (!accessToken) {
    await showAuthDialog()
    return
  }
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/previous', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (response.ok) {
      console.log('上一曲成功')
    } else {
      const errorData = await response.json()
      console.error('上一曲失败:', errorData)
    }
  } catch (error) {
    console.error('网络错误:', error)
  }
}

async function playNextTrack() {
  if (!accessToken) {
    await showAuthDialog()
    return
  }
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/next', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })

    if (response.ok) {
      console.log('下一曲成功')
    } else {
      const errorData = await response.json()
      console.error('下一曲失败:', errorData)
    }
  } catch (error) {
    console.error('网络错误:', error)
  }
}

// 获取当前播放状态
async function fetchPlayerState() {
  try {
    const response = await fetch('https://api.spotify.com/v1/me/player', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    })
    const data = await response.json()

    if (response.ok && data) {
      isPlaying = data.is_playing // 更新播放状态
      await createTray() // 根据播放状态更新托盘图标
    } else {
      console.error('获取播放状态失败:', data)
    }
  } catch (error) {
    console.error('网络错误:', error)
  }
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon1 } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  ipcMain.handle('get-access-token', () => accessToken)
}

function startOAuthFlow() {
  const clientId = '630ac25f2b4241e980dfe5b825b24980'
  const redirectUri = `http://localhost:${EXPRESS_PORT}/callback`
  const scope = 'user-modify-playback-state user-read-playback-state'
  const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&code_challenge_method=S256&code_challenge=${codeChallenge}`

  import('open')
    .then((open) => {
      open.default(authUrl)
    })
    .catch((err) => {
      console.error('Failed to open URL:', err)
    })
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  createTray()

  if (process.platform === 'darwin') {
    app.dock.hide()
    app.setActivationPolicy('accessory')
  }

  const tokens = loadTokens()
  if (tokens) {
    accessToken = tokens.accessToken
    refreshToken = tokens.refreshToken

    // 检查accessToken是否有效
    const valid = await checkAccessTokenValidity()
    if (!valid) {
      // 如果无效，尝试刷新令牌
      const refreshed = await refreshAccessToken()
      if (!refreshed) {
        // 如果刷新失败，重新授权
        await showAuthDialog()
      }
    } else {
      // 如果令牌有效，获取播放状态
      await fetchPlayerState()
    }
  } else {
    // 如果没有令牌，提示用户授权
    await showAuthDialog()
  }

  app.setAsDefaultProtocolClient('myapp')

  // 处理通过自定义 URL Scheme 打开的请求
  app.on('open-url', async (event, urlStr) => {
    console.log('Received URL:', urlStr)
    event.preventDefault()
    const parsedUrl = new URL(urlStr)
    console.log('Parsed URL:', parsedUrl)
    if (parsedUrl.protocol === 'myapp:' && parsedUrl.hostname === 'auth-success') {
      accessToken = parsedUrl.searchParams.get('access_token')
      console.log('拿到了Received Access Token:', accessToken)
      await fetchPlayerState()

      BrowserWindow.getAllWindows().forEach((window) => {
        console.log('Sending auth-success to window:', window)
        window.webContents.send('auth-success', accessToken)
      })
    }
  })

  // 设置 Express 本地服务器处理回调
  const server = express()

  server.get('/callback', async (req, res) => {
    const code = req.query.code
    if (code) {
      try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: `http://localhost:${EXPRESS_PORT}/callback`,
            client_id: '630ac25f2b4241e980dfe5b825b24980',
            code_verifier: codeVerifier
          })
        })

        const data = await response.json()

        if (response.ok) {
          accessToken = data.access_token
          refreshToken = data.refresh_token
          saveTokens({ accessToken, refreshToken }) // 保存令牌
          await fetchPlayerState()
          res.send('授权成功，您可以关闭此窗口。')
          return
        } else {
          console.error('获取令牌失败:', data)
          res.send('授权失败，请重试。')
          return
        }
      } catch (error) {
        console.error('获取令牌时发生错误:', error)
        res.send('发生错误，请重试。')
        return
      }
    }

    // 如果没有 code 参数，或者上述代码执行完毕，将执行以下代码
    res.send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <title>授权成功</title>
          </head>
          <body>
            <h1>授权成功！窗口将在 3 秒后自动关闭。</h1>
            <script>
              // 重定向到自定义协议
              const electronUrl = 'myapp://auth-success';
              window.location.href = electronUrl;

              // 3 秒后关闭窗口
              setTimeout(function() {
                window.close();
              }, 3000);
            </script>
          </body>
          </html>
    `)
  })

  server.listen(EXPRESS_PORT, () => {
    console.log(`Express server listening on http://localhost:${EXPRESS_PORT}`)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
