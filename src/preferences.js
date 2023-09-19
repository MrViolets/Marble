'use strict'

/* global chrome */

import * as ch from './chrome/promisify.js'

export const defaults = {
  enabled: {
    title: chrome.i18n.getMessage('MENU_AUTO_GROUP'),
    value: true,
    type: 'checkbox'
  },
  auto_close_groups: {
    title: chrome.i18n.getMessage('MENU_AUTO_CLOSE'),
    value: true,
    type: 'checkbox'
  },
  sort_alphabetically: {
    title: chrome.i18n.getMessage('MENU_SORT_ALPHABETICALLY'),
    value: false,
    type: 'checkbox'
  },
  auto_collapse_groups: {
    title: chrome.i18n.getMessage('MENU_AUTO_COLLAPSE'),
    value: false,
    type: 'checkbox'
  },
  group_by: {
    title: chrome.i18n.getMessage('MENU_GROUP_BY'),
    value: 'subdomain',
    type: 'radio',
    options: ['subdomain', 'domain']
  }
}

export async function get () {
  try {
    const result = await ch.storageLocalGet({ preferences: defaults })
    const userPreferences = result.preferences

    for (const key in userPreferences) {
      if (!(key in defaults)) {
        delete userPreferences[key]
      }
    }

    for (const defaultKey in defaults) {
      if (!(defaultKey in userPreferences)) {
        userPreferences[defaultKey] = defaults[defaultKey]
      }
    }

    return userPreferences
  } catch (error) {
    console.error(error)
    return defaults
  }
}
