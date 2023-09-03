'use strict'

/* global chrome */

export const menusCreate = promisifyChromeMethod(chrome.contextMenus.create.bind(chrome.contextMenus))
export const menusUpdate = promisifyChromeMethod(chrome.contextMenus.update.bind(chrome.contextMenus))
export const storageSyncGet = promisifyChromeMethod(chrome.storage.sync.get.bind(chrome.storage.sync))
export const storageSyncSet = promisifyChromeMethod(chrome.storage.sync.set.bind(chrome.storage.sync))
export const tabGroupsUpdate = promisifyChromeMethod(chrome.tabGroups.update.bind(chrome.tabGroups))
export const tabsCreate = promisifyChromeMethod(chrome.tabs.create.bind(chrome.tabs))
export const tabsUngroup = promisifyChromeMethod(chrome.tabs.ungroup.bind(chrome.tabs))
export const tabsGroup = promisifyChromeMethod(chrome.tabs.group.bind(chrome.tabs))
export const tabsGet = promisifyChromeMethod(chrome.tabs.get.bind(chrome.tabs))
export const tabsQuery = promisifyChromeMethod(chrome.tabs.query.bind(chrome.tabs))

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
