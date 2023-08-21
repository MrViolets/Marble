'use strict'

/* global chrome */

export function create (url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(
      {
        url
      },
      function () {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError.message)
        }
        resolve()
      }
    )
  })
}

export function getInCurrentWindow () {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ currentWindow: true }, function (tabs) {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message)
      }
      resolve(tabs)
    })
  })
}

export function get (tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, function (tab) {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message)
      }
      resolve(tab)
    })
  })
}

export function group (tabIds, groupId = null) {
  return new Promise((resolve, reject) => {
    const groupObject = groupId ? { groupId, tabIds } : { tabIds }

    chrome.tabs.group(groupObject, function (groupId) {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message)
      }
      resolve(groupId)
    })
  })
}

export function ungroup (tabIds) {
  return new Promise((resolve, reject) => {
    chrome.tabs.ungroup(tabIds, function () {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message)
      }
      resolve()
    })
  })
}
