'use strict'

/* global chrome */

import * as ch from '../chrome/promisify.js'
import * as preferences from '../preferences.js'

document.addEventListener('DOMContentLoaded', init)

async function init () {
  insertStrings()
  await restorePreferences()
  prepareAnimatedElements()
  registerListeners()
}

async function prepareAnimatedElements () {
  const animatedElements = document.querySelectorAll('.no-transition')

  for (const el of animatedElements) {
    const pseudoBefore = window.getComputedStyle(el, ':before').content
    const pseudoAfter = window.getComputedStyle(el, ':after').content
    const hasBeforeContent = pseudoBefore !== 'none' && pseudoBefore !== ''
    const hasAfterContent = pseudoAfter !== 'none' && pseudoAfter !== ''

    if (hasBeforeContent || hasAfterContent) {
      el.addEventListener(
        'transitionend',
        function () {
          el.classList.remove('no-transition')
        },
        { once: true }
      )
    }

    el.classList.remove('no-transition')
  }
}

function insertStrings () {
  const strings = document.querySelectorAll('[data-localize]')

  if (strings) {
    for (const s of strings) {
      s.innerText = chrome.i18n.getMessage(s.dataset.localize)
    }
  }

  const selectInputs = document.querySelectorAll('select')

  for (const s of selectInputs) {
    const options = getOptionsForKey(s.id, preferences.defaults)

    if (!options) {
      continue
    }

    // Remove any existing options
    s.innerHTML = ''

    // Add new options from the optionsArray
    for (const optionValue of options) {
      const capitalizedOption = optionValue.charAt(0).toUpperCase() + optionValue.slice(1)
      const optionElement = document.createElement('option')
      optionElement.value = optionValue
      optionElement.innerText = capitalizedOption
      s.appendChild(optionElement)
    }
  }
}

function getOptionsForKey (key, defaultsObject) {
  if (defaultsObject[key] && defaultsObject[key].options) {
    return defaultsObject[key].options
  }
  return null
}

async function restorePreferences () {
  const userPreferences = await preferences.get()

  for (const [preferenceName, preferenceObj] of Object.entries(userPreferences)) {
    const el = document.getElementById(preferenceName)

    if (preferenceObj.type === 'radio') {
      el.value = preferenceObj.value
    } else if (preferenceObj.type === 'checkbox') {
      el.checked = preferenceObj.value
    }
  }
}

function registerListeners () {
  const onAll = (target, event, handler) => {
    const elements = document.querySelectorAll(target)

    for (const el of elements) {
      el.addEventListener(event, handler, false)
    }
  }

  onAll('input[type="checkbox"]', 'change', onCheckBoxChanged)
  onAll('div.nav-index', 'click', onActionClicked)
}

async function onCheckBoxChanged (e) {
  await updateUserPreference(e, 'checked', !e.target.checked)
}

async function updateUserPreference (e, valueKey, backupValue) {
  const userPreferences = await preferences.get()
  const preference = userPreferences[e.target.id]

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
    await ch.sendMessage({ msg: 'preference_updated', id: e.target.id, value: preference.value })
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
