'use strict'

/* global chrome */

export function update (groupId, title, color) {
  return new Promise((resolve, reject) => {
    chrome.tabGroups.update(groupId, { color, title }, function (group) {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message)
      }
      resolve(group)
    })
  })
}

export function collapse (groupId) {
  return new Promise((resolve, reject) => {
    chrome.tabGroups.update(groupId, { collapsed: true }, function (group) {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError.message)
      }
      resolve(group)
    })
  })
}
