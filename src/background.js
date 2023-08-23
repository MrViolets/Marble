'use strict'

/* global chrome, createImageBitmap, OffscreenCanvas */

import * as menu from './modules/menu.js'
import * as storage from './modules/storage.js'
import * as tabs from './modules/tabs.js'
import * as tabGroups from './modules/tabGroups.js'
import * as tld from './modules/tld.js'

chrome.runtime.onInstalled.addListener(onInstalled)
chrome.runtime.onStartup.addListener(init)
chrome.tabs.onCreated.addListener(onTabCreated)
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
  const userPreferences = await storage.load('preferences', storage.preferenceDefaults).catch(error => {
    console.error(error)
    return storage.preferenceDefaults
  })
  const menuItemsFromPreferences = buildMenuStructureFromPreferences(userPreferences)

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

  const userPreferences = await storage.load('preferences', storage.preferenceDefaults).catch(error => {
    console.error(error)
    return storage.preferenceDefaults
  })

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

async function onTabCreated (tab) {
  if (!tab.id) return

  await addTabToGroup(tab)
}

async function onTabUpdated (tabId, changes, tab) {
  if (!changes.url || !tab.id) return

  await addTabToGroup(tab)
}

async function addTabToGroup (tab) {
  const enabledPreference = await storage.load('enabled', true).catch(error => {
    console.error(error)
    return true
  })

  if (enabledPreference === false) return

  const targetTab = await tabs.get(tab.id).catch(error => {
    console.error(error)
    return null
  })

  if (!targetTab) return

  const targetTabUrl = targetTab.url || targetTab.pendingUrl || null

  if (!targetTabUrl || isExcluded(targetTabUrl)) return

  const targetTabHostName = getHostName(targetTabUrl)
  const allTabs = await tabs.getInCurrentWindow().catch(error => {
    console.error(error)
    return null
  })

  if (!allTabs) return

  const userPreferences = await storage.load('preferences', storage.preferenceDefaults).catch(error => {
    console.error(error)
    return storage.preferenceDefaults
  })

  if (targetTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    const tabsInGroup = allTabs.filter(t => t.groupId === targetTab.groupId && t.id !== targetTab.id)
    const groupHasSameHostname = tabsInGroup.some(t => getHostName(t.url || t.pendingUrl || '') === targetTabHostName)

    if (!groupHasSameHostname) {
      try {
        // If 1 tab left in group then ungroup it
        if (userPreferences.auto_close_groups.value === false && tabsInGroup.length === 1) {
          for (const t of tabsInGroup) {
            await tabs.ungroup(t.id)
          }
        } else {
          await tabs.ungroup(targetTab.id)
        }
        await addTabToGroup(targetTab)
        return
      } catch (error) {
        console.error(error)
      }
    }
  }

  let groupId = null
  const tabsWithThisHostname = allTabs.reduce((accumulatedTabs, currentTab) => {
    if (getHostName(currentTab.url || currentTab.pendingUrl || '') === targetTabHostName) {
      accumulatedTabs.push(currentTab)
      if (currentTab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && groupId === null) {
        groupId = currentTab.groupId
      }
    }
    return accumulatedTabs
  }, [])

  const tabsToGroup = tabsWithThisHostname.map(tab => tab.id)

  if (tabsToGroup.length === 1 && userPreferences.auto_close_groups.value === false) return

  if (typeof groupId !== 'number') {
    groupId = await tabs.group(tabsToGroup).catch(error => {
      console.error(error)
      return -1
    })

    if (groupId === -1) return

    const siteName = getSiteName(targetTabUrl)

    const siteFaviconUrl = faviconURL(tabsWithThisHostname[0].url || tabsWithThisHostname[0].pendingUrl)
    let groupColor = 'gray'

    if (siteFaviconUrl) {
      try {
        groupColor = await getFaviconColor(siteFaviconUrl)
      } catch (error) {
        console.error(error)
      }
    }

    try {
      await tabGroups.update(groupId, siteName, groupColor)
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

async function groupAllTabsByHostname () {
  const allTabs = await tabs.getInCurrentWindow().catch(error => {
    console.error(error)
    return null
  })

  if (!allTabs) return

  const hostnames = [...new Set(allTabs.map(tab => getHostName(tab.url || tab.pendingUrl || '')))]

  for (const hostname of hostnames) {
    const tabsWithThisHostname = allTabs.filter(tab => getHostName(tab.url || tab.pendingUrl || '') === hostname)

    if (!tabsWithThisHostname || tabsWithThisHostname.length <= 1) continue

    const tabsToGroup = tabsWithThisHostname.map(tab => tab.id)

    let groupId = tabsWithThisHostname[0].groupId

    if (groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
      groupId = await tabs.group(tabsToGroup).catch(error => {
        console.error(error)
        return -1
      })

      if (groupId === -1) continue

      const siteName = getSiteName(tabsWithThisHostname[0].url || tabsWithThisHostname[0].pendingUrl)
      const siteFaviconUrl = faviconURL(tabsWithThisHostname[0].url || tabsWithThisHostname[0].pendingUrl)
      let groupColor = 'gray'

      if (siteFaviconUrl) {
        try {
          groupColor = await getFaviconColor(siteFaviconUrl)
        } catch (error) {
          console.error(error)
        }
      }

      try {
        await tabGroups.update(groupId, siteName, groupColor)
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

function faviconURL (u) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'))
  url.searchParams.set('pageUrl', u)
  url.searchParams.set('size', '32')
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

async function onTabRemoved () {
  const enabledPreference = await storage.load('enabled', true).catch(error => {
    console.error(error)
    return true
  })

  if (enabledPreference === false) return

  const userPreferences = await storage.load('preferences', storage.preferenceDefaults).catch(error => {
    console.error(error)
    return storage.preferenceDefaults
  })

  if (userPreferences.auto_close_groups.value === true) return

  const allTabs = await tabs.getInCurrentWindow().catch(error => {
    console.error(error)
    return null
  })

  if (!allTabs) return

  const groupCounts = allTabs.reduce((acc, tab) => {
    if (tab && tab.groupId !== undefined && tab.groupId !== null && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      acc[tab.groupId] = (acc[tab.groupId] || 0) + 1
    }
    return acc
  }, {})

  const singleTabGroups = Object.entries(groupCounts).filter(([_, count]) => count === 1)
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

async function onTabActivated (info) {
  const enabledPreference = await storage.load('enabled', true).catch(error => {
    console.error(error)
    return true
  })

  if (enabledPreference === false) return

  const userPreferences = await storage.load('preferences', storage.preferenceDefaults).catch(error => {
    console.error(error)
    return storage.preferenceDefaults
  })

  if (userPreferences.auto_collapse_groups.value === false) return

  const allTabs = await tabs.getInCurrentWindow().catch(error => {
    console.error(error)
    return null
  })

  if (!allTabs) return

  const tabActivated = allTabs.find(tab => tab.id === info.tabId)

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
