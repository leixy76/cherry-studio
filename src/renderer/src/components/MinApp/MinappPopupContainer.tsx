import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloseOutlined,
  CodeOutlined,
  CopyOutlined,
  ExportOutlined,
  LinkOutlined,
  MinusOutlined,
  PushpinOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { loggerService } from '@logger'
import { isLinux, isMac, isWin } from '@renderer/config/constant'
import { DEFAULT_MIN_APPS } from '@renderer/config/minapps'
import { useBridge } from '@renderer/hooks/useBridge'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useMinapps } from '@renderer/hooks/useMinapps'
import useNavBackgroundColor from '@renderer/hooks/useNavBackgroundColor'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { useAppDispatch } from '@renderer/store'
import { setMinappsOpenLinkExternal } from '@renderer/store/settings'
import { MinAppType } from '@renderer/types'
import { delay } from '@renderer/utils'
import { Alert, Avatar, Button, Drawer, Tooltip } from 'antd'
import { WebviewTag } from 'electron'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

import WebviewContainer from './WebviewContainer'

const logger = loggerService.withContext('MinappPopupContainer')

interface AppExtraInfo {
  canPinned: boolean
  isPinned: boolean
  canOpenExternalLink: boolean
}

type AppInfo = MinAppType & AppExtraInfo

/** Google login tip component */
const GoogleLoginTip = ({
  isReady,
  currentUrl,
  currentAppId
}: {
  appId?: string | null
  isReady: boolean
  currentUrl: string | null
  currentAppId: string | null
}) => {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const { openMinappById } = useMinappPopup()

  // 判断当前URL是否涉及Google登录
  const needsGoogleLogin = useMemo(() => {
    // 如果当前已经在Google小程序中，不需要显示提示
    if (currentAppId === 'google') return false

    if (!currentUrl) return false

    const googleLoginPatterns = [
      'accounts.google.com',
      'signin/oauth',
      'auth/google',
      'login/google',
      'sign-in/google',
      'google.com/signin',
      'gsi/client'
    ]

    return googleLoginPatterns.some((pattern) => currentUrl.toLowerCase().includes(pattern.toLowerCase()))
  }, [currentUrl, currentAppId])

  // 在URL更新时检查是否需要显示提示
  useEffect(() => {
    let showTimer: NodeJS.Timeout | null = null
    let hideTimer: NodeJS.Timeout | null = null

    // 如果是Google登录相关URL且小程序已加载完成，则延迟显示提示
    if (needsGoogleLogin && isReady) {
      showTimer = setTimeout(() => {
        setVisible(true)
        hideTimer = setTimeout(() => {
          setVisible(false)
        }, 30000)
      }, 500)
    } else {
      setVisible(false)
    }

    return () => {
      if (showTimer) clearTimeout(showTimer)
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [needsGoogleLogin, isReady, currentUrl])

  // 处理关闭提示
  const handleClose = () => {
    setVisible(false)
  }

  // 跳转到Google小程序
  const openGoogleMinApp = () => {
    // 使用openMinappById方法打开Google小程序
    openMinappById('google', true)
    // 关闭提示
    setVisible(false)
  }

  // 只在需要Google登录时显示提示
  if (!needsGoogleLogin || !visible) return null

  // 使用直接的消息文本
  const message = t('miniwindow.alert.google_login')

  return (
    <Alert
      message={message}
      type="warning"
      showIcon
      closable
      onClose={handleClose}
      action={
        <Button type="primary" size="small" onClick={openGoogleMinApp}>
          {t('common.open')} Google
        </Button>
      }
      style={{ zIndex: 10, animation: 'fadeIn 0.3s ease-in-out' }}
    />
  )
}

/** The main container for MinApp popup */
const MinappPopupContainer: React.FC = () => {
  const { openedKeepAliveMinapps, openedOneOffMinapp, currentMinappId, minappShow } = useRuntime()
  const { closeMinapp, hideMinappPopup } = useMinappPopup()
  const { pinned, updatePinnedMinapps } = useMinapps()
  const { t } = useTranslation()
  const backgroundColor = useNavBackgroundColor()
  const { isLeftNavbar, isTopNavbar } = useNavbarPosition()
  const dispatch = useAppDispatch()

  /** control the drawer open or close */
  const [isPopupShow, setIsPopupShow] = useState(true)
  /** whether the current minapp is ready */
  const [isReady, setIsReady] = useState(false)
  /** the current REAL url of the minapp
   * different from the app preset url, because user may navigate in minapp */
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)

  /** store the last minapp id and show status */
  const lastMinappId = useRef<string | null>(null)
  const lastMinappShow = useRef<boolean>(false)

  /** store the webview refs, one of the key to make them keepalive */
  const webviewRefs = useRef<Map<string, WebviewTag | null>>(new Map())
  /** indicate whether the webview has loaded  */
  const webviewLoadedRefs = useRef<Map<string, boolean>>(new Map())
  /** whether the minapps open link external is enabled */
  const { minappsOpenLinkExternal } = useSettings()

  const isInDevelopment = process.env.NODE_ENV === 'development'

  useBridge()

  /** set the popup display status */
  useEffect(() => {
    if (minappShow) {
      // init the current url
      if (currentMinappId && currentAppInfo) {
        setCurrentUrl(currentAppInfo.url)
      }

      setIsPopupShow(true)

      if (webviewLoadedRefs.current.get(currentMinappId)) {
        setIsReady(true)
        /** the case that open the minapp from sidebar */
      } else if (lastMinappId.current !== currentMinappId && lastMinappShow.current === minappShow) {
        setIsReady(false)
      }
    } else {
      setIsPopupShow(false)
      setIsReady(false)
    }

    return () => {
      /** renew the last minapp id and show status */
      lastMinappId.current = currentMinappId
      lastMinappShow.current = minappShow
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minappShow, currentMinappId])

  useEffect(() => {
    if (!webviewRefs.current) return

    /** set the webview display status
     * DO NOT use the state to set the display status,
     * to AVOID the re-render of the webview container
     */
    webviewRefs.current.forEach((webviewRef, appid) => {
      if (!webviewRef) return
      webviewRef.style.display = appid === currentMinappId ? 'inline-flex' : 'none'
    })

    //delete the extra webviewLoadedRefs
    webviewLoadedRefs.current.forEach((_, appid) => {
      if (!webviewRefs.current.has(appid)) {
        webviewLoadedRefs.current.delete(appid)
      } else if (appid === currentMinappId) {
        const webviewId = webviewRefs.current.get(appid)?.getWebContentsId()
        if (webviewId) {
          window.api.webview.setOpenLinkExternal(webviewId, minappsOpenLinkExternal)
        }
      }
    })
  }, [currentMinappId, minappsOpenLinkExternal])

  /** only the keepalive minapp can be minimized */
  const canMinimize = !(openedOneOffMinapp && openedOneOffMinapp.id == currentMinappId)

  /** combine the openedKeepAliveMinapps and openedOneOffMinapp */
  const combinedApps = useMemo(() => {
    return [...openedKeepAliveMinapps, ...(openedOneOffMinapp ? [openedOneOffMinapp] : [])]
  }, [openedKeepAliveMinapps, openedOneOffMinapp])

  /** get the extra info of the apps */
  const appsExtraInfo = useMemo(() => {
    return combinedApps.reduce(
      (acc, app) => ({
        ...acc,
        [app.id]: {
          canPinned: DEFAULT_MIN_APPS.some((item) => item.id === app.id),
          isPinned: pinned.some((item) => item.id === app.id),
          canOpenExternalLink: app.url.startsWith('http://') || app.url.startsWith('https://')
        }
      }),
      {} as Record<string, AppExtraInfo>
    )
  }, [combinedApps, pinned])

  /** get the current app info with extra info */
  let currentAppInfo: AppInfo | null = null
  if (currentMinappId) {
    const currentApp = combinedApps.find((item) => item.id === currentMinappId) as MinAppType
    currentAppInfo = { ...currentApp, ...appsExtraInfo[currentApp.id] }
  }

  /** will close the popup and delete the webview */
  const handlePopupClose = async (appid: string) => {
    setIsPopupShow(false)
    await delay(0.3)
    webviewLoadedRefs.current.delete(appid)
    closeMinapp(appid)
  }

  /** will hide the popup and remain the webviews */
  const handlePopupMinimize = async () => {
    setIsPopupShow(false)
    await delay(0.3)
    hideMinappPopup()
  }

  /** the callback function to set the webviews ref */
  const handleWebviewSetRef = (appid: string, element: WebviewTag | null) => {
    webviewRefs.current.set(appid, element)

    if (!webviewRefs.current.has(appid)) {
      webviewRefs.current.set(appid, null)
      return
    }

    if (element) {
      webviewRefs.current.set(appid, element)
    } else {
      webviewRefs.current.delete(appid)
    }
  }

  /** the callback function to set the webviews loaded indicator */
  const handleWebviewLoaded = (appid: string) => {
    webviewLoadedRefs.current.set(appid, true)
    const webviewId = webviewRefs.current.get(appid)?.getWebContentsId()
    if (webviewId) {
      window.api.webview.setOpenLinkExternal(webviewId, minappsOpenLinkExternal)
    }
    if (appid == currentMinappId) {
      setTimeout(() => setIsReady(true), 200)
    }
  }

  /** the callback function to handle webview navigation */
  const handleWebviewNavigate = (appid: string, url: string) => {
    // 记录当前URL，用于GoogleLoginTip判断
    if (appid === currentMinappId) {
      logger.debug(`URL changed: ${url}`)
      setCurrentUrl(url)
    }
  }

  /** will open the devtools of the minapp */
  const handleOpenDevTools = (appid: string) => {
    const webview = webviewRefs.current.get(appid)
    if (webview) {
      webview.openDevTools()
    }
  }

  /** only reload the original url */
  const handleReload = (appid: string) => {
    const webview = webviewRefs.current.get(appid)
    if (webview) {
      const url = combinedApps.find((item) => item.id === appid)?.url
      if (url) {
        webview.src = url
      }
    }
  }

  /** open the giving url in browser */
  const handleOpenLink = (url: string) => {
    window.api.openWebsite(url)
  }

  /** toggle the pin status of the minapp */
  const handleTogglePin = (appid: string) => {
    const app = combinedApps.find((item) => item.id === appid)
    if (!app) return

    const newPinned = appsExtraInfo[appid].isPinned ? pinned.filter((item) => item.id !== appid) : [...pinned, app]
    updatePinnedMinapps(newPinned)
  }

  /** set the open external status */
  const handleToggleOpenExternal = () => {
    dispatch(setMinappsOpenLinkExternal(!minappsOpenLinkExternal))
  }

  /** navigate back in webview history */
  const handleGoBack = (appid: string) => {
    const webview = webviewRefs.current.get(appid)
    if (webview && webview.canGoBack()) {
      webview.goBack()
    }
  }

  /** navigate forward in webview history */
  const handleGoForward = (appid: string) => {
    const webview = webviewRefs.current.get(appid)
    if (webview && webview.canGoForward()) {
      webview.goForward()
    }
  }

  /** Title bar of the popup */
  const Title = ({ appInfo, url }: { appInfo: AppInfo | null; url: string | null }) => {
    if (!appInfo) return null

    const handleCopyUrl = (event: any, url: string) => {
      //don't show app-wide context menu
      event.preventDefault()
      navigator.clipboard
        .writeText(url)
        .then(() => {
          window.message.success('URL ' + t('message.copy.success'))
        })
        .catch(() => {
          window.message.error('URL ' + t('message.copy.failed'))
        })
    }

    return (
      <TitleContainer style={{ backgroundColor: backgroundColor }}>
        <Tooltip
          title={
            <TitleTextTooltip>
              {url ?? appInfo.url} <br />
              <CopyOutlined className="icon-copy" />
              {t('minapp.popup.rightclick_copyurl')}
            </TitleTextTooltip>
          }
          mouseEnterDelay={0.8}
          placement="rightBottom"
          styles={{
            root: {
              maxWidth: '400px'
            }
          }}>
          <TitleText onContextMenu={(e) => handleCopyUrl(e, url ?? appInfo.url)}>{appInfo.name}</TitleText>
        </Tooltip>
        {appInfo.canOpenExternalLink && (
          <Tooltip title={t('minapp.popup.openExternal')} mouseEnterDelay={0.8} placement="bottom">
            <TitleButton onClick={() => handleOpenLink(url ?? appInfo.url)}>
              <ExportOutlined />
            </TitleButton>
          </Tooltip>
        )}
        <Spacer />
        <ButtonsGroup className={isWin || isLinux ? 'windows' : ''} isTopNavBar={isTopNavbar}>
          <Tooltip title={t('minapp.popup.goBack')} mouseEnterDelay={0.8} placement="bottom">
            <TitleButton onClick={() => handleGoBack(appInfo.id)}>
              <ArrowLeftOutlined />
            </TitleButton>
          </Tooltip>
          <Tooltip title={t('minapp.popup.goForward')} mouseEnterDelay={0.8} placement="bottom">
            <TitleButton onClick={() => handleGoForward(appInfo.id)}>
              <ArrowRightOutlined />
            </TitleButton>
          </Tooltip>
          <Tooltip title={t('minapp.popup.refresh')} mouseEnterDelay={0.8} placement="bottom">
            <TitleButton onClick={() => handleReload(appInfo.id)}>
              <ReloadOutlined />
            </TitleButton>
          </Tooltip>
          {appInfo.canPinned && (
            <Tooltip
              title={
                appInfo.isPinned
                  ? isTopNavbar
                    ? t('minapp.remove_from_launchpad')
                    : t('minapp.remove_from_sidebar')
                  : isTopNavbar
                    ? t('minapp.add_to_launchpad')
                    : t('minapp.add_to_sidebar')
              }
              mouseEnterDelay={0.8}
              placement="bottom">
              <TitleButton onClick={() => handleTogglePin(appInfo.id)} className={appInfo.isPinned ? 'pinned' : ''}>
                <PushpinOutlined style={{ fontSize: 16 }} />
              </TitleButton>
            </Tooltip>
          )}
          <Tooltip
            title={
              minappsOpenLinkExternal
                ? t('minapp.popup.open_link_external_on')
                : t('minapp.popup.open_link_external_off')
            }
            mouseEnterDelay={0.8}
            placement="bottom">
            <TitleButton onClick={handleToggleOpenExternal} className={minappsOpenLinkExternal ? 'open-external' : ''}>
              <LinkOutlined />
            </TitleButton>
          </Tooltip>
          {isInDevelopment && (
            <Tooltip title={t('minapp.popup.devtools')} mouseEnterDelay={0.8} placement="bottom">
              <TitleButton onClick={() => handleOpenDevTools(appInfo.id)}>
                <CodeOutlined />
              </TitleButton>
            </Tooltip>
          )}
          {canMinimize && (
            <Tooltip title={t('minapp.popup.minimize')} mouseEnterDelay={0.8} placement="bottom">
              <TitleButton onClick={() => handlePopupMinimize()}>
                <MinusOutlined />
              </TitleButton>
            </Tooltip>
          )}
          <Tooltip title={t('minapp.popup.close')} mouseEnterDelay={0.8} placement="bottom">
            <TitleButton onClick={() => handlePopupClose(appInfo.id)}>
              <CloseOutlined />
            </TitleButton>
          </Tooltip>
        </ButtonsGroup>
      </TitleContainer>
    )
  }

  /** group the webview containers with Memo, one of the key to make them keepalive */
  const WebviewContainerGroup = useMemo(() => {
    return combinedApps.map((app) => (
      <WebviewContainer
        key={app.id}
        appid={app.id}
        url={app.url}
        onSetRefCallback={handleWebviewSetRef}
        onLoadedCallback={handleWebviewLoaded}
        onNavigateCallback={handleWebviewNavigate}
      />
    ))

    // because the combinedApps is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedApps])

  return (
    <Drawer
      title={<Title appInfo={currentAppInfo} url={currentUrl} />}
      placement="bottom"
      onClose={handlePopupMinimize}
      open={isPopupShow}
      destroyOnClose={false}
      mask={false}
      rootClassName="minapp-drawer"
      maskClassName="minapp-mask"
      height={'100%'}
      maskClosable={false}
      closeIcon={null}
      style={{
        marginLeft: isLeftNavbar ? 'var(--sidebar-width)' : 0,
        marginTop: isTopNavbar ? 'var(--navbar-height)' : 0,
        backgroundColor: window.root.style.background
      }}>
      {/* 在所有小程序中显示GoogleLoginTip */}
      <GoogleLoginTip isReady={isReady} currentUrl={currentUrl} currentAppId={currentMinappId} />
      {!isReady && (
        <EmptyView>
          <Avatar
            src={currentAppInfo?.logo}
            size={80}
            style={{ border: '1px solid var(--color-border)', marginTop: -150 }}
          />
          <BeatLoader color="var(--color-text-2)" size={10} style={{ marginTop: 15 }} />
        </EmptyView>
      )}
      {WebviewContainerGroup}
    </Drawer>
  )
}

const TitleContainer = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding-right: 10px;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: transparent;
  [navbar-position='left'] & {
    padding-left: ${isMac ? '20px' : '10px'};
  }
  [navbar-position='top'] & {
    padding-left: ${isMac ? '20px' : '10px'};
    border-bottom: 0.5px solid var(--color-border);
  }
`

const TitleText = styled.div`
  font-weight: bold;
  font-size: 14px;
  color: var(--color-text-1);
  -webkit-app-region: no-drag;
  margin-right: 5px;
`

const TitleTextTooltip = styled.span`
  font-size: 0.8rem;

  .icon-copy {
    font-size: 0.7rem;
    padding-right: 5px;
  }
`

const ButtonsGroup = styled.div<{ isTopNavBar: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  -webkit-app-region: no-drag;
  &.windows {
    margin-right: ${(props) => (props.isTopNavBar ? 0 : isWin ? '130px' : isLinux ? '100px' : 0)};
    background-color: var(--color-background-mute);
    border-radius: 50px;
    padding: 0 3px;
    overflow: hidden;
  }
`

const TitleButton = styled.div`
  cursor: pointer;
  width: 30px;
  height: 30px;
  border-radius: 5px;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  color: var(--color-text-2);
  transition: all 0.2s ease;
  font-size: 14px;
  -webkit-app-region: no-drag;
  &:hover {
    color: var(--color-text-1);
    background-color: var(--color-background-mute);
  }
  &.pinned {
    color: var(--color-primary);
    background-color: var(--color-primary-bg);
  }
  &.open-external {
    color: var(--color-primary);
    background-color: var(--color-primary-bg);
  }
`

const EmptyView = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  background-color: var(--color-background);
`

const Spacer = styled.div`
  flex: 1;
`

export default MinappPopupContainer
