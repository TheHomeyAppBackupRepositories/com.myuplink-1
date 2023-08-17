/* eslint-disable no-nested-ternary */
/* eslint-disable no-multi-spaces */
/* eslint-disable node/no-unsupported-features/es-syntax */
/* eslint-disable comma-dangle */

'use strict';

const { URLSearchParams } = require('url');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const { OAuth2Client, OAuth2Error } = require('homey-oauth2app');
const { evaluate } = require('mathjs');
const { TYPE } = require('./common');
const { error } = require('console');
// const myUplinkOAuth2Token = require('./myUplinkOAuth2Token.js');

class myUplinkOAuth2Client extends OAuth2Client {

  // Required:
  static API_URL = 'https://api.myuplink.com/v2';
  static TOKEN_URL = 'https://api.myuplink.com/oauth/token';
  static AUTHORIZATION_URL = 'https://api.myuplink.com/oauth/authorize';
  static SCOPES = ['READSYSTEM WRITESYSTEM offline_access'];

  // Optional:
  // static TOKEN = myUplinkOAuth2Token; // Default: OAuth2Token
  // static REDIRECT_URL = 'https://callback.athom.com/oauth2/callback'; // Default: 'https://callback.athom.com/oauth2/callback'

  // onHandleNotOK does not need to be overloaded
  // async onHandleNotOK({ body }) {
  //   throw new OAuth2Error(body.error);
  // }

  async onInit() {
    this.log('*** MYUPLINK onInit ***');
    this.pendingDevicePoints = {};   // A list of device points that are about to be set
    this.confirmedDevicePoints = {}; // A list of device points that has been read
    this.var = {};                   // A list of variables defined in deviceDefinition.json
    this.keyMap = {};                // Filled with capabilities => myUplinkDevicePoints
    this.reverseKeyMap = {};         // Filled with myUplinkDevicePoints => capabilities
    this.errCnt = 0;
    this.timeSinceCapRefresh = 0;
    this.timeSinceSettingsRefresh = 0;
    this.updateID = undefined;
  }

  async onUninit() {
    this.log('*** MYUPLINK onUninit ***');
    if (this.updateID) {
      clearTimeout(this.updateID);
      this.updateID = undefined;
    }
  }

  stringMatch(string, filter) {
    if (string.length !== filter.length) return false;
    for (let i = 0; i < string.length; i++) {
      if (filter[i] === '*') continue;
      if (string[i] !== filter[i]) return false;
    }
    return true;
  }

  async discoverDevicesPrivate(filter) {
    try {
      this.log('Looking for devices');
      const devicelist = [];
      // Fetch 10 items each time
      let moreItems = true;
      let page = 1;
      while (moreItems) {
        const things = await this.getDevices({ page, itemsPerPage: 10 });
        page++;
        if (things.numItems < things.itemsPerPage) {
          moreItems = false;
        }

        for (let systemNr = 0; systemNr < things.systems.length; systemNr++) {
          const system = things.systems[systemNr];
          for (let deviceNr = 0; deviceNr < system.devices.length; deviceNr++) {
            const device = system.devices[deviceNr];

            if (filter) {
              if (filter.deviceName && !this.stringMatch(device.product.name, filter.deviceName)) {
                continue;
              } else if (filter.parameterId) {
                const parameterData = await this.getDevicePoints(device.id, filter.parameterId);
                if ((parameterData[0] === undefined) || parameterData[0].value !== filter.value) {
                  continue;
                }
              }
            }

            const mydevice = {
              name: filter === undefined ? system.name : undefined, // Replaced by product name in case a filter is given
              data: {
                systemId: system.systemId,
                systemName: system.name,
                deviceId: device.id,
                deviceSerial: device.product.serialNumber,
                deviceName: device.product.name
              }
              // settings: {},
              // icon: '',
              // class: '',
              // capabilities: []
              // capabilitiesOptions: []
            };
            devicelist.push(mydevice);
          }
        }
      }
      this.log('Finished discovering devices:');
      this.log(devicelist);
      return devicelist;
    } catch (err) {
      throw new Error(`Failed fetching devices: ${err}`);
    }
  }

  addLanguage(dest, input) {
    const {
      baseLangCode, baseLang, noLang, newLangCode, newLang
    } = input;
    const keys = Object.keys(newLang);
    for (let i = 0; i < keys.length; i++) {
      const key = Array.isArray(newLang) ? +keys[i] : keys[i];
      if (typeof newLang[key] === 'function') {
        throw new Error('Extracted data should not be a function!');
      } else if (newLang[key] === null) {
        dest[key] = null;
      } else if (typeof newLang[key] === 'object') {
        if (dest[key] === undefined) {
          if (Array.isArray(newLang[key])) {
            dest[key] = [];
          } else {
            dest[key] = {};
          }
        }
        this.addLanguage(dest[key], {
          baseLangCode,
          newLangCode,
          baseLang: baseLang[key],
          noLang: noLang[key],
          newLang: newLang[key]
        });
      } else if (dest[key] === undefined) {
        dest[key] = newLang[key];
      } else if (dest[key] !== newLang[key]) {
        if (/* newLang[key] === noLang[key] || */ newLang[key] === baseLang[key]) continue;
        if (dest[key][baseLangCode] !== baseLang[key]) {
          if (Array.isArray(baseLang[key])) {
            dest[key] = [];
          } else {
            dest[key] = {};
          }
          dest[key][baseLangCode] = baseLang[key];
        }
        dest[key][newLangCode] = newLang[key];
      } // Else new value is equal... ignore
    }
  }

  combineLanguages(input) {
    const languages = Object.keys(input);
    const output = [];
    for (let i = 0; i < languages.length; i++) {
      if (languages[i] === 'none') continue;
      this.addLanguage(output, {
        baseLangCode: 'en',
        newLangCode: languages[i],
        baseLang: input['en'],
        noLang: input['none'],
        newLang: input[languages[i]]
      });
    }
    return output;
  }

  async dumpAllState() {
    const deviceList = await this.discoverDevicesPrivate();
    for (let i = 0; i < deviceList.length; i++) {
      this.log(`Processing device ${deviceList[i].data.deviceId}`);
      this.log('Fetching language: none');
      const none = await this.getDevicePoints(deviceList[i].data.deviceId, {}, 'none');
      this.log('Fetching language: no');
      const no = await this.getDevicePoints(deviceList[i].data.deviceId, {}, 'nb');
      this.log('Fetching language: en');
      const en = await this.getDevicePoints(deviceList[i].data.deviceId, {}, 'en');
      this.log('Fetching language: sv');
      const sv = await this.getDevicePoints(deviceList[i].data.deviceId, {}, 'sv');
      this.log('Fetching language: de');
      const de = await this.getDevicePoints(deviceList[i].data.deviceId, {}, 'de');
      this.log('Fetching language: da');
      const da = await this.getDevicePoints(deviceList[i].data.deviceId, {}, 'da');
      this.log('Combining languages');
      deviceList[i].features = this.combineLanguages({
        none, en, no, sv, de, da
      });
    }
    console.log(JSON.stringify(deviceList, null, ''));
    this.homey.app.endDump();
  }

  async discoverDevices(filter) {
    if (this.homey.app.startDump()) await this.dumpAllState();
    return this.discoverDevicesPrivate(filter);
  }

  /* ************************************************************************** *
   *                             GETTER FUNCTIONS                               *
   * ************************************************************************** */

  async getDevices({ page }, language = 'en') {
    this.log('Get devices');
    return this.get({
      path: '/systems/me',
      headers: { 'Accept-Language': language },
      query: { page },
    });
  }

  async getSmartHomeMode(systemId, language = 'en') {
    this.log('getSmartHomeMode');
    return this.get({
      path: `/systems/${systemId}/smart-home-mode`,
      headers: { 'Accept-Language': language },
      // query: { page },
    });
  }

  async getDeviceInfo(deviceId, language = 'en') {
    this.log('getDeviceInfo');
    return this.get({
      path: `/devices/${deviceId}`,
      headers: { 'Accept-Language': language },
      // query: { page },
    });
  }

  async getDevicePoints(deviceId, parameters, language = 'en') {
    // this.log(`getDevicePoints(${deviceId}, ${parameters})`);
    return this.get({
      path: `/devices/${deviceId}/points`,
      headers: { 'Accept-Language': language },
      query: { parameters },
    })
      .then((gotValues) => {
        const promises = [];
        // Remove gotten values from pendingDevicePoints (if they match)
        // eslint-disable-next-line no-restricted-syntax
        for (let idx = 0; idx < gotValues.length; idx++) {
          const key = gotValues[idx].parameterId;
          const { value, strVal } = gotValues[idx];
          if (this.confirmedDevicePoints[key] !== undefined
            && this.confirmedDevicePoints[key] !== value
            && !this.device.killed) {
            promises.push(this.device.onDevicePointChanged(key, value, strVal));
          }
          this.confirmedDevicePoints[key] = value;
          if (key in this.pendingDevicePoints) {
            // eslint-disable-next-line eqeqeq
            if (value == this.pendingDevicePoints[key]) {
              this.log(`Key ${key} confirmed ${value} = ${this.pendingDevicePoints[key]}`);
              delete this.pendingDevicePoints[key];
            } else {
              this.log(`Key ${key} not confirmed (set value: ${this.pendingDevicePoints[key]}, actual: ${value}`);
            }
          }
        }
        return Promise.all(promises)
          .then(() => Promise.resolve(gotValues));
      })
      .catch((err) => {
        this.log(`err ${err}`);
        const newErr = new Error(`Error reading ${JSON.stringify(parameters)}: ${err}`);
        return Promise.reject(newErr);
      }); // Pass on errors
  }

  async setDevicePoint(deviceId, parameters) {
    // eslint-disable-next-line no-restricted-syntax
    for (const key in parameters) {
      if (key in this.confirmedDevicePoints
        && !(key in this.pendingDevicePoints)
        // eslint-disable-next-line eqeqeq
        && parameters[key] == this.confirmedDevicePoints[key]) {
        this.log(`Ignoring setting unchanged parameter ${key} to ${parameters[key]}}`);
        delete parameters[key];
      }
    }
    if (Object.keys(parameters).length === 0) {
      return true;
    }

    this.pendingDevicePoints = {
      ...this.pendingDevicePoints,
      ...parameters
    };

    this.log(`Setting parameters: ${Object.keys(parameters)} to ${Object.values(parameters)}`);
    return this.patch({
      path: `/devices/${deviceId}/points`,
      json: parameters,
    })
      .then((res) => {
        this.log(`Set response: ${JSON.stringify(res)}`);
        return Promise.resolve(res);
      })
      .catch((err) => {
        const details = (err.message === '409 Conflict') ? ' (Check that the device has power and a network connection)' : '';
        const newErr = new Error(`Failed setting ${JSON.stringify(parameters)} due to ${err.message}${details}`);
        return Promise.reject(newErr);
      });
  }

  /**
   * Generates a list of values that are legal for a specific device point
   */
  async getDevicePointValues(devicePoint, customList = undefined) {
    const devpointMap = this.deviceDefinition.devPointTable;
    const devicePointSettings = customList || devpointMap[devicePoint];

    if (devicePointSettings === undefined) return [];

    const results = [];
    const {
      type, enumValues, minValue, maxValue, scaleValue, parameterUnit
    } = devicePointSettings;
    // eslint-disable-next-line no-nested-ternary
    let step = (scaleValue === '0.01')
      ? 10 : (+scaleValue)
        ? (1 / +scaleValue) : 1;
    if ((maxValue - minValue) / step > 1000) {
      step = (maxValue - minValue) / 1000;
    }
    const numDecimals = (+scaleValue < 1) ? 1 : 0;
    switch (type) {
      case TYPE.ENUM:
        for (let i = 0; i < enumValues.length; i++) {
          const name = typeof enumValues[i].text === 'string' ? enumValues[i].text : this.homey.__(enumValues[i].text);
          results.push({ id: enumValues[i].value, name, description: '' });
        }
        break;
      case TYPE.NUMBER:
        for (let i = minValue; i <= maxValue; i += step) {
          const name = `${Number(i * +scaleValue).toFixed(numDecimals)} ${parameterUnit}`;
          results.push({ id: (i * +scaleValue), name, description: '' });
        }
        break;
      default:
        return [];
    }

    return results;
  }

  /**
   * Retrieve active alarms for specified system.
   * Optional ignored parameters are
   * page: default value is 1
   * itemsPerPage: default value is 10
   * Accept-Language: default value is en-US
   */
  async getActiveNotifications(systemId) {
    this.log('getActiveNotifications');
    return this.get({
      path: `/systems/${systemId}/notifications/active`
    });
  }

  /**
   * Retrieve all (active, inactive and archived) alarms for specified system.
   * Same parameters as getActiveNotification
   */
  async getNotifications(systemId) {
    this.log('getNotifications');
    return this.get({
      path: `/systems/${systemId}/notifications`
    });
  }

  /**
   * Synchronizes the states between the app and myUplink
   * The function is called once on app initialization, after that it will continue for
   * eternity keeping the state synched.
   */
  async synchronizeStates(statesLeft) {
    let fetchStateError;
    this.updateID = undefined;
    this.log(`Fetching states: ${JSON.stringify(statesLeft)}`);
    try {
      const stateToFetch = statesLeft.join(',');
      let stateRequest;
      try {
        stateRequest = await this.getDevicePoints(this.deviceId, stateToFetch);
        // this.log(`State response: ${JSON.stringify(stateRequest)}`);
      } catch (innerErr) {
        throw new Error(`Network problem: ${innerErr.message}`);
      }

      const fetchedStates = {}; // States going to settings
      if (Array.isArray(stateRequest)) {
        for (let val = 0; val < stateRequest.length; val++) {
          if ('parameterId' in stateRequest[val]) {
            const { value, strVal, parameterId } = stateRequest[val];
            if (!(parameterId in this.reverseKeyMap)) {
              this.log(`ERROR: parameterId ${parameterId} missing from device definition`);
              continue;
            }
            const settingName = String(this.reverseKeyMap[parameterId].value);
            if (settingName.substring(0, 6) === 'status'
              || settingName.substring(0, 7) === 'setting') {
              if (this.settingTypes[settingName] === 'number') {
                fetchedStates[settingName] = +value; // Value without unit
              } else if (this.settingTypes[settingName] === 'dropdown') {
                fetchedStates[settingName] = `${value}`;
                // myUplink may contain invalid values, make sure that the value above was legal or remove it
                const { enumValues } = this.deviceDefinition.devPointTable[parameterId];
                if (Array.isArray(enumValues) && enumValues.length > 0) {
                  if (!(enumValues.map((a) => +a.value).includes(+value))) {
                    this.log(`WARNING: myUplink contains an invalid value ${value} for devicePoint ${parameterId} (device: ${this.deviceDefinition.name})`);
                    fetchedStates[settingName] = undefined;
                  }
                }
              } else {
                fetchedStates[settingName] = String(strVal); // Value with unit
              }
            } else if (parameterId in this.deviceDefinition.capTable) {
              this.log(`Setting capability: ${settingName} = ${value}`);
              const startName = settingName.substring(0, 5);
              if (startName === 'onoff' || startName === 'alarm') {
                this.device.setCapabilityValue(settingName, +value ? true : false);
              } else if (settingName[0] !== '$') {
                if (settingName.substring(0, 9) === 'max_power') {
                  await this.device.setCapabilityValue(settingName, String(value));
                } else {
                  await this.device.setCapabilityValue(settingName, +value);
                }
              }
            }
            // Update dependent values:
            await this.onValueUpdate(parameterId, value);
          }
        }
      }
      await this.onValueUpdate('all');
      if (Object.keys(fetchedStates).length > 0) {
        try {
          // Todo: Move firmware check elsewhere
          fetchedStates.firmwareVersion = 'unknown';
          const firmwareResponse = await this.getDeviceInfo(this.deviceId);
          if (firmwareResponse && ('firmware' in firmwareResponse) && ('currentFwVersion' in firmwareResponse.firmware)) {
            fetchedStates.firmwareVersion = String(firmwareResponse.firmware.currentFwVersion);
          }
          // this.log('Setting settings:');
          // this.log(fetchedStates);

          const oldSettings = this.device.getSettings();
          // this.log('Old settings:');
          // this.log(oldSettings);

          // eslint-disable-next-line no-restricted-syntax, guard-for-in
          for (const name in fetchedStates) {
            if (typeof fetchedStates[name] !== typeof oldSettings[name]) {
              this.log(`Incorrect type of setting ${name}: New type: ${typeof fetchedStates[name]} Old type: ${typeof oldSettings[name]}`);
            }
          }
          await this.device.setSettings(fetchedStates);
        } catch (innerErr) {
          // Nothing I possibly can do?
          //  - Disk full
          //  - State from myUplink is invalid
          throw new Error(`Could not save settings, will retry in a bit: ${innerErr}`);
        }
      }
      // Remove states from state requests:
      if (Array.isArray(stateRequest)) {
        const fetchedParams = stateRequest.map((item) => item.parameterId);
        statesLeft = statesLeft.filter((value) => !fetchedParams.includes(value));
      }
    } catch (err) {
      // Can be 'Network problem' or 'toSettings failed' (disk full?)
      fetchStateError = err;
      this.log(`Error: ${err}`);
    } finally {
      let refreshRate = 60;
      if (statesLeft.length > 0) {
        // The device is still not initialized
        this.log(`Could not fetch the following states: ${JSON.stringify(statesLeft)}`);
        if (!fetchStateError) {
          fetchStateError = `Could not fetch all states: ${JSON.stringify(statesLeft)}; Please send a crash report to the developer so this can be investigated and fixed.`;
        }
        this.log(fetchStateError);
        this.device.setUnavailable(`Error: ${fetchStateError}`);
        // Retry this function again in a while
        this.errCnt++;
        refreshRate = this.device.getSettings().updateRateErr * Math.min(this.errCnt, 5);
      } else {
        // All device points ok
        this.log('Device points refreshed');
        this.device.setAvailable();
        this.errCnt = 0;
        const { updateRate, updateRateSettings } = this.device.getSettings();
        refreshRate = Math.max(5, Math.min(updateRate - this.timeSinceCapRefresh, updateRateSettings - this.timeSinceSettingsRefresh));
        this.timeSinceCapRefresh += refreshRate;
        this.timeSinceSettingsRefresh += refreshRate;

        // Schedule next refresh of state
        if (this.timeSinceCapRefresh >= updateRate) {
          this.timeSinceCapRefresh = 0;
          statesLeft = statesLeft.concat(Object.keys(this.deviceDefinition.capTable || {}).filter((key) => key[0] !== '$'));
          statesLeft = statesLeft.concat(Object.keys(this.deviceDefinition.onChange || {}).filter((key) => (key[0] !== '$' && key !== 'all')));
        }
        if (this.timeSinceSettingsRefresh >= updateRateSettings) {
          this.timeSinceSettingsRefresh = 0;
          statesLeft = statesLeft.concat(Object.keys(this.deviceDefinition.settingsTable  || {}).filter((key) => key[0] !== '$'));
          statesLeft = statesLeft.concat(Object.keys(this.deviceDefinition.statusTable  || {}).filter((key) => key[0] !== '$'));
        }
      }

      this.log(`States to be fetched: ${statesLeft}, in ${refreshRate} s`);
      this.updateID = setTimeout(() => {
        if (this.device.killed) return;
        this.synchronizeStates(statesLeft);
      }, refreshRate * 1000);
    }
  }

  async updateState(deviceId) {
    return Promise.resolve()
      .then(() => {

      })
      .then((response) => {
        if (response && response.ok) {
          this.setAvailable(); // pending State has been resolved
        }
        return Promise.resolve();
      })
      .catch((err) => {
        const newErr = new Error(`Network problem: ${err.message}`);
        this.setUnavailable(newErr);
        return Promise.reject(newErr);
      });
  }

  mapTable(table = {}, type) {
    const retVal = {};
    for (const key of Object.keys(table)) {
      if ((key[0] !== '$') && (key !== 'all')) { // Do not map variables
        const value = typeof table[key] === 'string' ? table[key] : 'variable';
        retVal[key] = { value, type };
      }
    }
    return retVal;
  }

  /**
   * Maps device points so they can be used by the flow cards.
   * Used by the generic driver only. (other devices pick this from the device definition)
   */
  mapDevPoints(devPoints) {
    const retval = {};
    for (let i = 0; i < devPoints.length; i++) {
      const { enumValues, value, parameterId } = devPoints[i];
      const type = (Number.isFinite(value) && enumValues.length === 0)
        ? TYPE.NUMBER : (Number.isFinite(value))
          ? TYPE.ENUM : TYPE.UNKNOWN;
      retval[parameterId] = {
        ...devPoints[i],
        type
      };
    }
    return retval;
  }

  // Initialize device
  async initDevice(device, deviceDefinition) {
    this.log(`Initializing device ${device.deviceId}`);
    this.device = device;
    this.deviceId = device.deviceId;
    this.driverId = deviceDefinition.driverId;
    this.deviceDefinition = deviceDefinition;

    // === Generic drivers have no definition, need to generate one ===
    if (this.deviceDefinition.devPointTable === undefined) {
      this.log('Generic driver detected, added deviceDefinitions from myUplink (english only)');
      const devPoints = await this.getDevicePoints(this.deviceId, {}, 'en');
      this.deviceDefinition.devPointTable = this.mapDevPoints(devPoints);
      this.deviceDefinition.capTable = device.getStore().capTable;
      this.deviceDefinition.onChange = device.getStore().onChange;
      this.deviceDefinition.onCreated = device.getStore().onCreated;
      this.deviceDefinition.onChange.all = {};
    }

    // === Aquire the device states ===
    this.doneInit = this.device.getStoreValue('doneInit') || false;
    this.var = this.device.getStoreValue('var') || {};
    this.log(`gotDoneInit: ${this.doneInit}`);

    // === Prepare key maps ===
    this.log('Synchronizing states');
    this.reverseKeyMap = {
      ...this.mapTable(deviceDefinition.onChange, 'onChange'),
      ...this.mapTable(deviceDefinition.capTable, 'cap'),
      ...this.mapTable(deviceDefinition.settingsTable, 'settings'),
      ...this.mapTable(deviceDefinition.statusTable, 'status'),
    };

    this.keyMap = {};
    const keys = Object.keys({ ...this.mapTable(deviceDefinition.capTable, 'cap') });
    for (let keyNr = 0; keyNr < keys.length; keyNr++) {
      this.keyMap[this.reverseKeyMap[keys[keyNr]].value] = keys[keyNr];
    }

    // === Find the setting types to be used in synchronizeStates ===
    // The setting types are found in the driver manifest
    this.driverManifest = device.homey.manifest.drivers.filter((driver) => driver.id === this.driverId)[0];
    const allSettings = [
      ...this.driverManifest.settings[0].children,
      ...this.driverManifest.settings[1].children,
      ...this.driverManifest.settings[2].children
    ];
    this.settingTypes = {};
    for (let i = 0; i < allSettings.length; i++) {
      this.settingTypes[allSettings[i].id] = allSettings[i].type;
    }

    // === Set all capability values and settings ===
    const statesLeft = Object.keys(this.reverseKeyMap);
    if (!this.doneInit) {
      const actionQueue = Object.keys(this.deviceDefinition.onCreated);
      for (let i = 0; i < actionQueue.length; i++) {
        const key = actionQueue[i];
        let value = this.deviceDefinition.onCreated[key];
        if (value === '#now') value = (new Date()).getTime();
        if (key[0] === '$') {
          this.var[key] = value;
        } else {
          const newState = {};
          newState[key] = value;
          await this.setDevicePoint(device.deviceId, newState);
        }
      }
      await this.device.setStoreValue('var', this.var);
    }
    await this.synchronizeStates(statesLeft);

    // === Add Capability listeners ===
    this.log('Adding capability listeners');
    await this.addCapListeners(device, deviceDefinition.capTable);

    // === Finalizing init ===
    await this.device.setStoreValue('doneInit', true);
    this.log(`Device ${device.deviceId} fully initialized.`);
  }

  // Adds capability listeners for writeable devices
  async addCapListeners(device, capLinks = {}) {
    const defaultWriteable = ['onoff', 'target_temperature'];
    const keys = Object.keys(capLinks);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const cap = capLinks[key];
      const mainCap = cap.split('.')[0];
      const isWriteable = defaultWriteable.includes(mainCap)
        || (Object.keys(device.homey.manifest.capabilities).includes(cap) && device.homey.manifest.capabilities[cap].setable);
      if (isWriteable) {
        device.registerCapabilityListener(cap, async (newVal) => {
          return this.onValueUpdate(key, newVal, true)
            .then(() => this.onValueUpdate('all', undefined, true));
        });
        this.log(`Added listener: ${cap}`);
      } else {
        this.log(`Skipped listener: ${cap}`);
      }
    }
    return Promise.resolve();
  }

  /**
   * Run whenever a value changed, this happens in 2 cases:
   * - When a user changed a capability value
   * - When reading a capability value from myUplink
   */
  async onValueUpdate(key, newVal = undefined, fromCap = false) {
    const stateToSet = {};
    let varUpdated = false;

    // 1) Update the value, either the variable or myUplink directly
    //    (if the source of the change is from myUplink then ignore)
    if (fromCap) {
      if (key[0] === '$') {
        // Update the variable
        this.var[key] = newVal;
        varUpdated = true;
      } else if (key !== 'all') {
        // Update myUplink
        stateToSet[key] = +newVal; // Convert true/false to 1/0
      }
    }

    // 2) If there is a task-list, execute it:
    //    Both variables and other keys may have task lists
    const taskList =  this.deviceDefinition.onChange[key];
    if (taskList) {
      const taskKeys = Object.keys(taskList);
      for (let i = 0; i < taskKeys.length; i++) {
        const taskKey = taskKeys[i];
        let taskValue = taskList[taskKey];
        // Replace #now with the current time:
        taskValue = taskValue.replace('#now', (new Date()).getTime());
        // Replace all devicePoints:
        const deviceIdRegexp = /#([0-9]+)/g;
        let found = deviceIdRegexp.exec(taskValue);
        while (Array.isArray(found)) {
          const value = this.confirmedDevicePoints[found[1]];
          taskValue = taskValue.replace(found[0], value);
          found = deviceIdRegexp.exec(taskValue);
        }
        // Replace all variables in the task
        // The longest variable names are replaced first in order to avoid leftover remains of variables starting with the same text
        const varKeys = Object.keys(this.var);
        for (let varidx = varKeys.length - 1; varidx >= 0; varidx--) {
          taskValue = taskValue.replace(RegExp(`\\${varKeys[varidx]}`, 'g'), this.var[varKeys[varidx]]);
        }
        // Evaluate all equations
        taskValue = evaluate(taskValue) || 0;
        if (taskKey[0] === '$') {
          // Update the variable
          const capName = this.deviceDefinition.capTable[taskKey];
          if (capName && (this.var[taskKey] !== taskValue)) {
            const startName = capName.substring(0, 5);
            if (startName === 'onoff' || startName === 'alarm') {
              console.log(`Set ${capName}    = ${+taskValue ? true : false}`);
              await this.device.setCapabilityValue(capName, +taskValue ? true : false);
            } else if (capName.substring(0, 9) === 'max_power') {
              await this.device.setCapabilityValue(capName, String(taskValue));
            } else {
              await this.device.setCapabilityValue(capName, +taskValue);
            }
          }
          if (this.var[taskKey] !== taskValue) {
            this.var[taskKey] = taskValue;
            varUpdated = true;
          }
        } else {
          // Update myUplink
          stateToSet[taskKey] = taskValue;
        }
      }
    }

    if (varUpdated) await this.device.setStoreValue('var', this.var);
    if (fromCap) await this.setDevicePoint(this.device.deviceId, stateToSet);
    return Promise.resolve();
  }

} // myUplinkOAuth2Client

module.exports = myUplinkOAuth2Client;
