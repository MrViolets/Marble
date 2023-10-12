'use strict'

/* global chrome */

import * as ch from '../chrome/promisify.js'
import * as preferences from '../preferences.js'

document.addEventListener('DOMContentLoaded', init)

async function init () {
  await insertStrings()
  await restorePreferences()
  registerListeners()
}

async function insertStrings () {
  const strings = document.querySelectorAll('[data-localize]')

  if (strings) {
    for (const s of strings) {
      s.innerText = chrome.i18n.getMessage(s.dataset.localize)
    }
  }

  const accelerators = document.querySelectorAll('[data-accelerator]')

  const platformInfo = await ch.getPlatformInfo().catch((error) => {
    console.error(error)
  })

  if (accelerators) {
    for (const a of accelerators) {
      if (platformInfo.os === 'mac') {
        a.innerText = chrome.i18n.getMessage(
            `ACCELERATOR_${a.dataset.accelerator}_MAC`
        )
      } else {
        a.innerText = chrome.i18n.getMessage(
            `ACCELERATOR_${a.dataset.accelerator}`
        )
      }
    }
  }
}

async function restorePreferences () {
  const userPreferences = await preferences.get()

  for (const [preferenceName, preferenceObj] of Object.entries(userPreferences)) {
    if (preferenceObj.type === 'radio') {
      const radioToCheck = document.querySelector(`input[name="${preferenceName}"][value="${preferenceObj.value}"]`)
      if (radioToCheck) {
        radioToCheck.checked = true
      }
    } else if (preferenceObj.type === 'checkbox') {
      const el = document.getElementById(preferenceName)
      if (el) {
        el.checked = preferenceObj.value
      }
    }
  }
}

function registerListeners () {
  const on = (target, event, handler) => {
    if (typeof target === 'string') {
      document.getElementById(target).addEventListener(event, handler, false)
    } else {
      target.addEventListener(event, handler, false)
    }
  }

  const onAll = (target, event, handler) => {
    const elements = document.querySelectorAll(target)

    for (const el of elements) {
      el.addEventListener(event, handler, false)
    }
  }

  on(document, 'keydown', onDocumentKeydown)
  onAll('input[type="checkbox"]', 'change', onCheckBoxChanged)
  onAll('input[type="radio"]', 'change', onRadioChanged)
  onAll('div.nav-index', 'click', onActionClicked)
}

async function onCheckBoxChanged (e) {
  await updateUserPreference(e, e.target.id, 'checked', !e.target.checked)
}

async function onRadioChanged (e) {
  await updateUserPreference(e, e.target.name, 'value', e.target.value)
}

async function updateUserPreference (e, target, valueKey, backupValue) {
  const userPreferences = await preferences.get()
  const preference = userPreferences[target]

  if (!preference) return

  preference.value = e.target[valueKey]

  try {
    await ch.storageLocalSet({ preferences: userPreferences })
  } catch (error) {
    console.error(error)
    e.target[valueKey] = backupValue
    return
  }

  try {
    await ch.sendMessage({ msg: 'preference_updated', id: target, value: preference.value })
  } catch (error) {
    console.error(error)
  }
}

async function onActionClicked (e) {
  if (e.target.id === 'rate' || e.target.id === 'donate') {
    openExternal(e.target.id)
  } else if (e.target.id === 'group_now') {
    try {
      await ch.sendMessage({ msg: 'group_now' })
    } catch (error) {
      console.error(error)
      e.target.checked = !e.target.checked
    }
  }

  window.close()
}

async function openExternal (type) {
  let url

  if (type === 'rate') {
    const extensionId = chrome.runtime.id
    url = `https://chrome.google.com/webstore/detail/${extensionId}`
  } else if (type === 'donate') {
    url = 'https://www.buymeacoffee.com/mrviolets'
  }

  try {
    await ch.tabsCreate({ url })
  } catch (error) {
    console.error(error)
  }
}

function onDocumentKeydown (e) {
  try {
    if (e.key === 'l' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
      const groupNowButton = document.getElementById('group_now')
      groupNowButton.click()
    }
  } catch (error) {
    console.error(error)
  }
}
