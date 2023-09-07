'use strict'

/* global chrome, createImageBitmap, OffscreenCanvas */

import * as ch from './chrome/promisify.js'
import * as preferences from './preferences.js'

chrome.runtime.onInstalled.addListener(onInstalled)
chrome.tabs.onUpdated.addListener(onTabUpdated)
chrome.tabs.onRemoved.addListener(onTabRemoved)
chrome.tabs.onActivated.addListener(onTabActivated)
chrome.runtime.onMessage.addListener(onMessageReceived)
chrome.commands.onCommand.addListener(onCommandReceived)

async function onInstalled (info) {
  if (info.reason === 'install') {
    await groupAllTabsByHostname()
  }
}

async function onTabUpdated (tabId, changes, tab) {
  if (changes.url && tabId) {
    await addTabToGroup(tabId)
  }
}

async function groupAllTabsByHostname () {
  const allTabs = await getAllValidTabs(false)

  if (!allTabs) return

  const windows = {}

  allTabs.forEach(tab => {
    if (!windows[tab.windowId]) {
      windows[tab.windowId] = []
    }
    windows[tab.windowId].push(tab)
  })

  for (const windowId in windows) {
    const windowTabs = windows[windowId]
    const hostnames = findAllHostnamesInTabs(windowTabs)

    for (const hostname of hostnames) {
      const tabsWithThisHostname = allTabsWithSameHostname(windowTabs, hostname)

      if (!tabsWithThisHostname || tabsWithThisHostname.length === 1) continue

      const tabsToGroup = tabsWithThisHostname.map(tab => tab.id)
      let groupId = tabsWithThisHostname[0].groupId

      if (groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
        groupId = await ch.tabsGroup({
          tabIds: tabsToGroup,
          createProperties: { windowId: parseInt(windowId) }
        }).catch(error => {
          console.error(error)
          return -1
        })

        if (groupId === -1) continue

        const siteName = parseUrl(tabsWithThisHostname[0].pendingUrl || tabsWithThisHostname[0].url).siteName || 'Untitled'
        const siteFaviconUrl = faviconURL(tabsWithThisHostname[0].pendingUrl || tabsWithThisHostname[0].url)
        const groupColor = await getFaviconColor(siteFaviconUrl)

        try {
          await ch.tabGroupsUpdate(groupId, { title: siteName, color: groupColor })
        } catch (error) {
          console.error(error)
        }
      } else {
        try {
          await ch.tabsGroup({ tabIds: tabsToGroup, groupId })
        } catch (error) {
          console.error(error)
        }
      }
    }
  }
}

async function onTabRemoved () {
  if (!await extensionIsEnabled()) return

  const userPreferences = await preferences.get()

  if (userPreferences.auto_close_groups.value === false) return

  const allTabs = await getAllValidTabs()

  if (!allTabs) return

  const groupCounts = getTabGroupCounts(allTabs)
  const singleTabGroups = getSingleTabGroups(groupCounts)
  const singleTabGroupIds = singleTabGroups.map(([groupId]) => parseInt(groupId))

  for (const groupId of singleTabGroupIds) {
    const tabToUngroup = allTabs.find(tab => tab.groupId === groupId)
    if (tabToUngroup) {
      try {
        await ch.tabsUngroup(tabToUngroup.id)
      } catch (error) {
        console.error(error)
      }
    }
  }
}

async function onTabActivated (info) {
  if (!await extensionIsEnabled()) return

  const userPreferences = await preferences.get()

  if (userPreferences.auto_collapse_groups.value === false) return

  await collapseUnusedGroups(info.tabId)
}

async function addTabToGroup (tabId) {
  if (!await extensionIsEnabled()) return

  const targetTab = await ch.tabsGet(tabId).catch(error => {
    console.error(error)
    return null
  })

  if (!targetTab) return

  const targetTabUrl = targetTab.pendingUrl || targetTab.url || null

  if (!targetTabUrl || isExcluded(targetTabUrl)) return

  const parsedUrl = parseUrl(targetTabUrl)
  const allTabs = await getAllValidTabs()

  if (!allTabs) return

  const tabsInGroup = findTabsInGroup(allTabs, targetTab)
  const groupHasSameHostname = allTabsContainsHostname(tabsInGroup, parsedUrl.domain)

  if (tabsInGroup.length && groupHasSameHostname && targetTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    // this means the tab doesn't need to move, don't do anything
    return
  } else if (targetTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    // This means the tab needs to move
    try {
      await ch.tabsUngroup(targetTab.id)
    } catch (error) {
      console.error(error)
    }
  }

  const targetGroupId = findTargetGroupId(allTabs, targetTab, parsedUrl.domain)

  if (targetGroupId !== null) {
    try {
      await ch.tabsGroup({ tabIds: [targetTab.id], groupId: targetGroupId })
    } catch (error) {
      console.error(error)
    }
  } else {
    const matchingTabs = allTabsWithSameHostname(allTabs, parsedUrl.domain)

    if (matchingTabs.length > 1) {
      const matchingTabsIds = matchingTabs.map(t => t.id)

      const newGroupId = await ch.tabsGroup({ tabIds: matchingTabsIds }).catch(error => {
        console.error(error)
        return -1
      })

      if (newGroupId === -1) return

      const siteName = parsedUrl.siteName || 'Untitled'
      const siteFaviconUrl = faviconURL(matchingTabs[0].pendingUrl || matchingTabs[0].url)
      const groupColor = await getFaviconColor(siteFaviconUrl)

      try {
        await ch.tabGroupsUpdate(newGroupId, { title: siteName, color: groupColor })
      } catch (error) {
        console.error(error)
      }
    }
  }
}

async function collapseUnusedGroups (tabId) {
  const allTabs = await ch.tabsQuery({ currentWindow: true }).catch(error => {
    console.error(error)
    return []
  })

  if (!allTabs) return

  const tabActivated = allTabs.find(tab => tab.id === tabId)

  if (!tabActivated) return

  const activeTabGroupId = tabActivated.groupId

  if (activeTabGroupId === undefined) return

  const otherGroupIds = allTabs
    .filter(tab => tab.groupId !== activeTabGroupId && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
    .map(tab => tab.groupId)
  const uniqueOtherGroupIds = [...new Set(otherGroupIds)]

  const MAX_RETRIES = 5
  const RETRY_DELAY = 25

  for (const groupId of uniqueOtherGroupIds) {
    if (!groupId) continue
    let retries = 0
    while (retries < MAX_RETRIES) {
      try {
        await ch.tabGroupsUpdate(groupId, { collapsed: true })
        break
      } catch (error) {
        retries++
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY))
      }
    }
  }
}

async function extensionIsEnabled () {
  try {
    const userPreferences = await preferences.get()
    return userPreferences.enabled.value
  } catch (error) {
    console.error(error)
    return true
  }
}

function findTabsInGroup (allTabs, targetTab) {
  return allTabs.filter(t => t.groupId === targetTab.groupId && t.id !== targetTab.id)
}

function allTabsContainsHostname (tabsInGroup, targetTabHostName) {
  return tabsInGroup.some(t => parseUrl(t.pendingUrl || t.url || '').domain === targetTabHostName)
}

function findTargetGroupId (allTabs, targetTab, targetTabHostName) {
  for (const tab of allTabs) {
    if (tab.id === targetTab.id) continue // Skip the target tab

    const tabHostname = parseUrl(tab.pendingUrl || tab.url).domain
    if (tabHostname === targetTabHostName && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      return tab.groupId
    }
  }

  return null
}

function allTabsWithSameHostname (allTabs, targetTabHostName) {
  return allTabs.filter(tab => {
    const tabHostname = parseUrl(tab.pendingUrl || tab.url).domain
    return tabHostname === targetTabHostName
  })
}

async function getAllValidTabs (onlyCurrentWindow = true) {
  const queryInfo = onlyCurrentWindow ? { currentWindow: true } : {}

  const allTabs = await ch.tabsQuery(queryInfo).catch(error => {
    console.error(error)
    return []
  })

  if (!allTabs) return null

  const validTabs = allTabs.filter(tab => {
    const tabUrl = tab.pendingUrl || tab.url || ''
    return !isExcluded(tabUrl)
  })

  return validTabs.length ? validTabs : null
}

function findAllHostnamesInTabs (allTabs) {
  return [...new Set(
    allTabs
      .map(tab => parseUrl(tab.pendingUrl || tab.url || '').domain)
      .filter(Boolean)
  )]
}

function getTabGroupCounts (allTabs) {
  return allTabs.reduce((acc, tab) => {
    if (tab && tab.groupId !== undefined && tab.groupId !== null && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      acc[tab.groupId] = (acc[tab.groupId] || 0) + 1
    }
    return acc
  }, {})
}

function getSingleTabGroups (groupCounts) {
  return Object.entries(groupCounts).filter(([_, count]) => count === 1)
}

function faviconURL (u) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'))
  url.searchParams.set('pageUrl', u)
  url.searchParams.set('size', '16')
  return url.toString()
}

function isExcluded (url) {
  const excludedUrls = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'extension://',
    'brave://',
    'opera://',
    'vivaldi://'
  ]

  return excludedUrls.some(excluded => url.startsWith(excluded))
}

function calculateDistance (color1, color2) {
  const dr = color1.r - color2.r
  const dg = color1.g - color2.g
  const db = color1.b - color2.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

async function getFaviconColor (faviconUrl) {
  const colors = [
    { name: 'grey', rgb: { r: 130, g: 130, b: 130 } },
    { name: 'blue', rgb: { r: 20, g: 100, b: 255 } },
    { name: 'red', rgb: { r: 255, g: 40, b: 30 } },
    { name: 'yellow', rgb: { r: 255, g: 170, b: 0 } },
    { name: 'green', rgb: { r: 20, g: 130, b: 50 } },
    { name: 'pink', rgb: { r: 200, g: 20, b: 130 } },
    { name: 'purple', rgb: { r: 160, g: 60, b: 240 } },
    { name: 'cyan', rgb: { r: 0, g: 130, b: 128 } },
    { name: 'orange', rgb: { r: 255, g: 140, b: 60 } }
  ]

  const isIgnoredPixel = (r, g, b, a) => {
    const whiteValue = 255
    return a === 0 || (r === whiteValue && g === whiteValue && b === whiteValue)
  }

  try {
    const response = await fetch(faviconUrl)
    const blob = await response.blob()
    const imageBitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imageBitmap, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data

    let rTotal = 0; let gTotal = 0; let bTotal = 0
    let pixelCount = 0

    for (let i = 0; i < imageData.length; i += 4) {
      if (!isIgnoredPixel(imageData[i], imageData[i + 1], imageData[i + 2], imageData[i + 3])) {
        rTotal += imageData[i]
        gTotal += imageData[i + 1]
        bTotal += imageData[i + 2]
        pixelCount++
      }
    }

    if (pixelCount === 0) return 'grey'

    const isGray = (r, g, b, threshold = 15) => {
      return Math.abs(r - g) <= threshold &&
               Math.abs(r - b) <= threshold &&
               Math.abs(g - b) <= threshold
    }

    const rAvg = Math.round(rTotal / pixelCount)
    const gAvg = Math.round(gTotal / pixelCount)
    const bAvg = Math.round(bTotal / pixelCount)

    if (isGray(rAvg, gAvg, bAvg)) {
      return 'grey'
    }

    let closestColor = colors[0]
    let minDistance = calculateDistance({ r: rAvg, g: gAvg, b: bAvg }, closestColor.rgb)

    for (let i = 1; i < colors.length; i++) {
      const distance = calculateDistance({ r: rAvg, g: gAvg, b: bAvg }, colors[i].rgb)
      if (distance < minDistance) {
        minDistance = distance
        closestColor = colors[i]
      }
    }

    return closestColor.name
  } catch (error) {
    console.error(error)
    return 'grey'
  }
}

function parseUrl (inputUrl) {
  if (!inputUrl || inputUrl.length === 0) {
    return {}
  }

  const url = new URL(inputUrl)
  const domainParts = url.hostname.split('.')

  let topLevelDomain
  let subdomain = ''

  topLevelDomain = domainParts.pop()

  const secondaryTLDs = ['co', 'com', 'ac', 'gov', 'net', 'org', 'edu']
  if (domainParts.length && secondaryTLDs.includes(domainParts[domainParts.length - 1])) {
    topLevelDomain = `${domainParts.pop()}.${topLevelDomain}`
  }

  const host = domainParts.pop()

  if (domainParts.length) {
    subdomain = domainParts.join('.')
  }

  let siteName
  if (subdomain === 'www') {
    siteName = host
  } else {
    siteName = subdomain.length > 0 ? `${subdomain}.${host}` : host
  }

  return {
    protocol: url.protocol.slice(0, -1),
    domain: url.hostname,
    path: url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname,
    subdomain,
    host,
    tld: topLevelDomain,
    parentDomain: host ? `${host}.${topLevelDomain}` : '',
    siteName
  }
}

async function onMessageReceived (message, sender, sendResponse) {
  try {
    if (message.msg === 'preference_updated') {
      sendResponse()

      if (message.id === 'enabled' && message.value === true) {
        await groupAllTabsByHostname()
      }
    } else if (message.msg === 'group_now') {
      sendResponse()

      await groupAllTabsByHostname()
    }
  } catch (error) {
    console.error(error)
  }
}

async function onCommandReceived (command) {
  if (command === 'group_all') {
    await groupAllTabsByHostname()
  }
}
