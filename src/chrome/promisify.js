'use strict'

/* global chrome */

export const storageLocalGet = promisifyChromeMethod(chrome.storage.local.get.bind(chrome.storage.local))
export const storageLocalSet = promisifyChromeMethod(chrome.storage.local.set.bind(chrome.storage.local))
export const tabGroupsUpdate = promisifyChromeMethod(chrome.tabGroups.update.bind(chrome.tabGroups))
export const tabGroupsGet = promisifyChromeMethod(chrome.tabGroups.get.bind(chrome.tabGroups))
export const tabGroupsMove = promisifyChromeMethod(chrome.tabGroups.move.bind(chrome.tabGroups))
export const tabGroupsQuery = promisifyChromeMethod(chrome.tabGroups.query.bind(chrome.tabGroups))
export const tabsCreate = promisifyChromeMethod(chrome.tabs.create.bind(chrome.tabs))
export const tabsUngroup = promisifyChromeMethod(chrome.tabs.ungroup.bind(chrome.tabs))
export const tabsMove = promisifyChromeMethod(chrome.tabs.move.bind(chrome.tabs))
export const tabsGroup = promisifyChromeMethod(chrome.tabs.group.bind(chrome.tabs))
export const tabsGet = promisifyChromeMethod(chrome.tabs.get.bind(chrome.tabs))
export const tabsQuery = promisifyChromeMethod(chrome.tabs.query.bind(chrome.tabs))
export const tabsUpdate = promisifyChromeMethod(chrome.tabs.update.bind(chrome.tabs))
export const sendMessage = promisifyChromeMethod(chrome.runtime.sendMessage.bind(chrome.runtime))
export const getPlatformInfo = promisifyChromeMethod(chrome.runtime.getPlatformInfo.bind(chrome.runtime))
export const windowsGetCurrent = promisifyChromeMethod(chrome.windows.getCurrent.bind(chrome.windows))

function promisifyChromeMethod (method) {
  return (...args) =>
    new Promise((resolve, reject) => {
      method(...args, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || JSON.stringify(chrome.runtime.lastError)))
        } else {
          resolve(result)
        }
      })
    })
}
