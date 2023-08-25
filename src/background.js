'use strict'

/* global chrome, createImageBitmap, OffscreenCanvas */

import * as menu from './modules/menu.js'
import * as storage from './modules/storage.js'
import * as tabs from './modules/tabs.js'
import * as tabGroups from './modules/tabGroups.js'
import * as tld from './modules/tld.js'

chrome.runtime.onInstalled.addListener(onInstalled)
chrome.runtime.onStartup.addListener(init)
chrome.tabs.onUpdated.addListener(onTabUpdated)
chrome.tabs.onRemoved.addListener(onTabRemoved)
chrome.tabs.onActivated.addListener(onTabActivated)
chrome.contextMenus.onClicked.addListener(onMenuClicked)

async function onInstalled (info) {
  await init()

  if (info.reason === 'install') {
    await groupAllTabsByHostname()
  }
}

async function init () {
  await setupContextMenu()
  await loadPreferences()
}

async function setupContextMenu () {
  const menuItemsFromPreferences = buildMenuStructureFromPreferences(storage.preferenceDefaults)

  const menuItems = [
    {
      title: chrome.i18n.getMessage('MENU_AUTO_GROUP'),
      contexts: ['action'],
      id: 'toggle_extension',
      type: 'checkbox'
    },
    {
      contexts: ['action'],
      id: 'separator_1',
      type: 'separator'
    },
    ...menuItemsFromPreferences,
    {
      contexts: ['action'],
      id: 'separator_2',
      type: 'separator'
    },
    {
      title: chrome.i18n.getMessage('MENU_RATE'),
      contexts: ['action'],
      id: 'rate_extension',
      type: 'normal'
    },
    {
      title: chrome.i18n.getMessage('MENU_DONATE'),
      contexts: ['action'],
      id: 'donate',
      type: 'normal'
    }
  ]

  try {
    await menu.create(menuItems)
  } catch (error) {
    console.error(error)
  }
}

function buildMenuStructureFromPreferences (preferences) {
  const menuStructure = [
    {
      title: chrome.i18n.getMessage('MENU_PREFERENCES'),
      contexts: ['action'],
      id: 'preferences',
      type: 'normal'
    }
  ]

  for (const key in preferences) {
    const menuItem = getMenuItem(preferences[key], key)
    menuStructure.push(...menuItem)
  }

  return menuStructure
}

function getMenuItem (preference, key) {
  const temp = []

  if (preference.type === 'checkbox') {
    const menuItem = {
      title: preference.title,
      contexts: ['action'],
      id: key,
      type: 'checkbox',
      parentId: 'preferences'
    }

    temp.push(menuItem)
  }

  if (preference.type === 'radio') {
    const parentItem = {
      title: preference.title,
      contexts: ['action'],
      id: key,
      type: 'normal',
      parentId: 'preferences'
    }

    temp.push(parentItem)

    for (const option of preference.options) {
      const childItem = {
        title: option,
        contexts: ['action'],
        id: `${key}.${option}`,
        type: 'radio',
        parentId: key
      }

      temp.push(childItem)
    }
  }

  return temp
}

async function loadPreferences () {
  const enabledPreference = await storage.load('enabled', true).catch(error => {
    console.error(error)
    return true
  })

  try {
    await menu.update('toggle_extension', enabledPreference)
  } catch (error) {
    console.error(error)
  }

  let userPreferences = await storage.load('preferences', storage.preferenceDefaults).catch(error => {
    console.error(error)
    return storage.preferenceDefaults
  })

  // Prune any changed settings
  userPreferences = Object.fromEntries(
    Object.entries(userPreferences).filter(
      ([key]) => key in storage.preferenceDefaults
    )
  )

  // Save pruned preferences back to storage
  await storage.save('preferences', userPreferences)

  try {
    for (const [preferenceName, preferenceObj] of Object.entries(userPreferences)) {
      if (preferenceObj.type === 'radio') {
        await menu.update(`${preferenceName}.${preferenceObj.value}`, true)
      } else if (preferenceObj.type === 'checkbox') {
        await menu.update(preferenceName, preferenceObj.value)
      }
    }
  } catch (error) {
    console.error(error)
  }
}

async function onTabUpdated (tabId, changes, tab) {
  if (changes.url && tabId) {
    await addTabToGroup(tabId)
  }
}

async function groupAllTabsByHostname () {
  const allTabs = await getAllValidTabs()

  if (!allTabs) return

  const hostnames = findAllHostnamesInTabs(allTabs)

  for (const hostname of hostnames) {
    const tabsWithThisHostname = allTabsWithSameHostname(allTabs, hostname)

    if (!tabsWithThisHostname) continue

    if (tabsWithThisHostname.length === 1) {
      if (tabsWithThisHostname[0].groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        await tabs.ungroup(tabsWithThisHostname[0].id)
      }

      continue
    }

    const tabsToGroup = tabsWithThisHostname.map(tab => tab.id)

    let groupId = tabsWithThisHostname[0].groupId

    if (groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      groupId = await tabs.group(tabsToGroup).catch(error => {
        console.error(error)
        return -1
      })

      if (groupId === -1) continue

      const siteName = getSiteName(tabsWithThisHostname[0].pendingUrl || tabsWithThisHostname[0].url)
      const siteFaviconUrl = faviconURL(tabsWithThisHostname[0].pendingUrl || tabsWithThisHostname[0].url)
      const groupColor = await getFaviconColor(siteFaviconUrl)

      try {
        await tabGroups.update(groupId, { title: siteName, color: groupColor })
      } catch (error) {
        console.error(error)
      }
    } else {
      try {
        await tabs.group(tabsToGroup, groupId)
      } catch (error) {
        console.error(error)
      }
    }
  }
}

async function onMenuClicked (info, tab) {
  const { menuItemId, parentMenuItemId, checked } = info

  if (storage.preferenceDefaults[menuItemId] || storage.preferenceDefaults[parentMenuItemId ?? '']) {
    const userPreferences = await storage.load('preferences', storage.preferenceDefaults).catch(error => {
      console.error(error)
      return storage.preferenceDefaults
    })
    const preference = userPreferences[menuItemId]
    const parentPreference = userPreferences[parentMenuItemId ?? '']

    if (parentPreference && parentPreference.type === 'radio') {
      parentPreference.value = menuItemId.split('.')[1]
    } else if (preference.type === 'checkbox') {
      preference.value = checked
    }

    try {
      await storage.save('preferences', userPreferences)
    } catch (error) {
      console.error(error)
    }
  } else if (menuItemId === 'rate_extension' || menuItemId === 'donate') {
    try {
      await openTab(menuItemId)
    } catch (error) {
      console.error(error)
    }
  } else if (menuItemId === 'toggle_extension') {
    if (checked) {
      await groupAllTabsByHostname()
    }
    try {
      await storage.save('enabled', checked)
    } catch (error) {
      console.error(error)
    }
  }
}

async function openTab (type) {
  const urls = {
    rate_extension: `https://chrome.google.com/webstore/detail/${chrome.runtime.id}`,
    donate: 'https://www.buymeacoffee.com/mrviolets'
  }

  const url = urls[type]
  if (url) {
    try {
      await tabs.create(url)
    } catch (error) {
      console.error(error)
    }
  }
}

async function onTabRemoved () {
  if (!await extensionIsEnabled()) return

  const allTabs = await getAllValidTabs()

  if (!allTabs) return

  const groupCounts = getTabGroupCounts(allTabs)
  const singleTabGroups = getSingleTabGroups(groupCounts)
  const singleTabGroupIds = singleTabGroups.map(([groupId]) => parseInt(groupId))

  for (const groupId of singleTabGroupIds) {
    const tabToUngroup = allTabs.find(tab => tab.groupId === groupId)
    if (tabToUngroup) {
      try {
        await tabs.ungroup(tabToUngroup.id)
      } catch (error) {
        console.error(error)
      }
    }
  }
}

async function onTabActivated (info) {
  if (!await extensionIsEnabled()) return

  const userPreferences = await storage.load('preferences', storage.preferenceDefaults).catch(error => {
    console.error(error)
    return storage.preferenceDefaults
  })

  if (userPreferences.auto_collapse_groups.value === false) return

  await collapseUnusedGroups(info.tabId)
}

async function addTabToGroup (tabId) {
  if (!await extensionIsEnabled()) return

  const targetTab = await tabs.get(tabId).catch(error => {
    console.error(error)
    return null
  })

  if (!targetTab) return

  const targetTabUrl = targetTab.pendingUrl || targetTab.url || null

  if (!targetTabUrl || isExcluded(targetTabUrl)) return

  const targetTabHostName = getHostName(targetTabUrl)

  const allTabs = await getAllValidTabs()

  if (!allTabs) return

  const tabsInGroup = findTabsInGroup(allTabs, targetTab)
  const groupHasSameHostname = allTabsContainsHostname(tabsInGroup, targetTabHostName)

  if (tabsInGroup.length && groupHasSameHostname && targetTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    // this means the tab doesn't need to move, don't do anything
    return
  } else if (targetTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    // This means the tab needs to move
    try {
      await tabs.ungroup(targetTab.id)
    } catch (error) {
      console.error(error)
    }
  }

  const targetGroupId = findTargetGroupId(allTabs, targetTab, targetTabHostName)

  if (targetGroupId !== null) {
    try {
      await tabs.group(targetTab.id, targetGroupId)
    } catch (error) {
      console.error(error)
    }
  } else {
    const matchingTabs = allTabsWithSameHostname(allTabs, targetTabHostName)

    if (matchingTabs.length > 1) {
      const matchingTabsIds = matchingTabs.map(t => t.id)
      const newGroupId = await tabs.group(matchingTabsIds).catch(error => {
        console.error(error)
        return -1
      })

      if (newGroupId === -1) return

      const siteName = getSiteName(targetTabUrl)
      const siteFaviconUrl = faviconURL(matchingTabs[0].pendingUrl || matchingTabs[0].url)
      const groupColor = await getFaviconColor(siteFaviconUrl)

      try {
        await tabGroups.update(newGroupId, { title: siteName, color: groupColor })
      } catch (error) {
        console.error(error)
      }
    }
  }
}

async function collapseUnusedGroups (tabId) {
  const allTabs = await tabs.getInCurrentWindow().catch(error => {
    console.error(error)
    return null
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
        await tabGroups.collapse(groupId)
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
    return await storage.load('enabled', true)
  } catch (error) {
    console.error(error)
    return true
  }
}

function findTabsInGroup (allTabs, targetTab) {
  return allTabs.filter(t => t.groupId === targetTab.groupId && t.id !== targetTab.id)
}

function allTabsContainsHostname (tabsInGroup, targetTabHostName) {
  return tabsInGroup.some(t => getHostName(t.pendingUrl || t.url || '') === targetTabHostName)
}

function findTargetGroupId (allTabs, targetTab, targetTabHostName) {
  for (const tab of allTabs) {
    if (tab.id === targetTab.id) continue // Skip the target tab

    const tabHostname = getHostName(tab.pendingUrl || tab.url)
    if (tabHostname === targetTabHostName && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      return tab.groupId
    }
  }

  return null
}

function allTabsWithSameHostname (allTabs, targetTabHostName) {
  return allTabs.filter(tab => {
    const tabHostname = getHostName(tab.pendingUrl || tab.url)
    return tabHostname === targetTabHostName
  })
}

async function getAllValidTabs () {
  const allTabs = await tabs.getInCurrentWindow().catch(error => {
    console.error(error)
    return null
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
      .map(tab => getHostName(tab.pendingUrl || tab.url || ''))
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

function getHostName (url) {
  try {
    const parsedURL = new URL(url)
    return parsedURL.hostname
  } catch (error) {
    return null
  }
}

function getSiteName (url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    let baseName = hostname

    for (const j of tld.commonTLDs) {
      if (baseName.endsWith(j)) {
        baseName = baseName.replace(j, '')
        break
      }
    }

    return baseName
  } catch (error) {
    return 'Group'
  }
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
