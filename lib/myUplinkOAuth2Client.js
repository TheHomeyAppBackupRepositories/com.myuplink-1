/* eslint-disable no-nested-ternary */
/* eslint-disable no-multi-spaces */
/* eslint-disable node/no-unsupported-features/es-syntax */
/* eslint-disable comma-dangle */

'use strict';

const fs = require('fs');

const { OAuth2Client } = require('homey-oauth2app');
const { evaluate } = require('mathjs');
const { TYPE } = require('./common');
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
    this.pendingDevicePoints = {};   // Array of [deviceId][devicePoint], filled with the values a devicePoint should be set to before being set
    this.confirmedDevicePoints = {}; // Array of [deviceId][devicePoint], filled with the values of the device points that has been read
    this.doPrefetch = {};            // Array of [deviceId][devicePoint], filled with True upon request. Which will initiate prefetch of the devicepoints
    this.deviceMap = {};             // Array of [deviceId]  = array of instanceId that control this deviceId
    this.devices = [];               // Array of [instanceId] =
    // Per-device data: { device, deviceId, driverId, deviceDefinition, vars, keyMap, reverseKeyMap, updateID,
    //                    errCnt, timeSinceCapRefresh, timeSinceCacheRefresh, timeSinceSettingsRefresh,
    //                    settingTypes, doneInit }
  }

  async onUninit() {
    this.log('*** MYUPLINK onUninit ***');
    for (let i = 0; i < this.devices.length; i++) {
      this.unInitDevice(i);
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

  async discoverDevicesPrivate(filters) {
    this.log('Looking for devices');
    let gotFirstResponse = false;
    const promises = [];
    const devicelist = [];
    const foundNames = [];

    // Make sure that a timeout happens in case no devices are discovered
    promises.push(
      new Promise((resolve, reject) => setTimeout(() => {
        if (gotFirstResponse) resolve();
        else reject(new Error('Timeout, No response in 300 ms.'));
      }, 60000))
    );

    // Fetch 10 items each time
    let moreItems = true;
    let page = 1;
    while (moreItems) {
      let thisWasLast = false;
      const newPromise = this.getDevices({ page, itemsPerPage: 10 })
        .then((things) => {
          console.log('Got devices - Checking for matches.....');
          if (things.numItems < things.itemsPerPage) {
            thisWasLast = true;
          }
          const devicePromises = [];
          for (let systemNr = 0; systemNr < things.systems.length; systemNr++) {
            const system = things.systems[systemNr];
            for (let deviceNr = 0; deviceNr < system.devices.length; deviceNr++) {
              const device = system.devices[deviceNr];
              console.log(`  * ${system.name} : ${device.id}`);

              devicePromises.push(
                new Promise((resolve, reject) => {
                  // Step 1 gather an array of matches against the different filters
                  const filterRes = [];
                  if (Array.isArray(filters)) {
                    for (let i = 0; i < filters.length; i++) {
                      const { filter } = filters[i];
                      if (filter.deviceName && !this.stringMatch(device.product.name, filter.deviceName)) {
                        filterRes.push(Promise.resolve({ match: false }));
                      } else if (filter.parameterId) {
                        filterRes.push(Promise.resolve({ parameterData: this.getDevicePoints(device.id, filter.parameterId) }));
                      } else {
                        // This filter matched
                        filterRes.push(Promise.resolve({ match: true }));
                      }
                    }
                    // Return matches
                    resolve(Promise.all(filterRes));
                  }
                  // Filter is corrupted
                  reject();
                })
                  .then((filterRes) => {
                    for (let i = 0; i < filterRes.length; i++) {
                      if (filterRes[i].match === true) {
                        return Promise.resolve(i);
                      }
                      if (filterRes[i].match === undefined) {
                        // Test filter (parameterData is always defined)
                        if ((filterRes[i].parameterData[0] !== undefined) && filterRes[i].parameterData[0].value === filters[i].filter.value) {
                          return Promise.resolve(i);
                        }
                      }
                    }
                    return Promise.reject();
                  })
                  .then((matchingIndex) => {
                    // Device should be added
                    let preName = filters[matchingIndex].filter === undefined ? system.name : filters[matchingIndex].name;
                    if (foundNames.includes(preName)) {
                      preName = `${preName} (${system.name})`;
                    } else {
                      foundNames.push(preName);
                    }
                    const mydevice = {
                      name: preName, // Replaced by product name in case a filter is given
                      icon: `../../../assets/icons/${filters[matchingIndex].icon}`,
                      data: {
                        definitionFile: filters[matchingIndex].filename,
                        systemId: system.systemId,
                        systemName: system.name,
                        deviceId: device.id,
                        deviceSerial: device.product.serialNumber,
                        deviceName: device.product.name
                      },
                      // settings: {}, // Initial values for settings
                      // class: '',
                      capabilities: filters[matchingIndex].capabilities
                      // capabilitiesOptions: []
                    };
                    devicelist.push(mydevice);
                    return Promise.resolve();
                  })
                  .catch((err) => {
                    // Device didn't match
                    return Promise.resolve();
                  })
              );
            }
          }
          return Promise.any(devicePromises);
        });
      promises.push(newPromise.catch((err) => Promise.resolve()));
      await newPromise
        .catch((err) => {
          thisWasLast = true;
        });
      if (thisWasLast) moreItems = false;
      if (devicelist.length > 0) gotFirstResponse = true;
      page++;
    }

    await Promise.any(promises)
      .catch((err) => {
        throw err;
      });
    return devicelist;
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
      try {
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
      } catch (err) {
        this.log(`Error: ${err}`);
      }
    }
    console.log(JSON.stringify(deviceList, null, ''));
    this.homey.app.endDump();
  }

  async discoverDevices(driver) {
    // Fetch device definitions
    const deviceFilesPath = `${await this.homey.app.getBasePath()}/drivers/${driver.id}/devices`;
    const deviceFiles = fs.readdirSync(deviceFilesPath);
    const validDevices = [];
    for (let i = 0; i < deviceFiles.length; i++) {
      const newDevice = JSON.parse(fs.readFileSync(`${deviceFilesPath}/${deviceFiles[i]}`));
      newDevice.filename = deviceFiles[i];
      validDevices.push(newDevice);
    }
    // Construct filters from the definitions
    const filters = [];
    for (let i = 0; i < validDevices.length; i++) {
      const {
        name, filter, icon, driverId, filename, capabilities
      } = validDevices[i];
      filters.push({
        name, filter, icon, driverId, filename, capabilities
      });
    }

    console.log('Discover devices, filter:');
    console.log(filters);
    const filteredDevices = await this.discoverDevicesPrivate(filters);
    if (this.homey.app.startDump()) this.dumpAllState();
    return filteredDevices;
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

  async getDevicePoints(deviceId, parameters, language) {
    // this.log(`getDevicePoints(${deviceId}, ${parameters})`);
    return this.get({
      path: `/devices/${deviceId}/points`,
      headers: { 'Accept-Language': language },
      query: { parameters },
    })
      .then((gotValues) => {
        const promises = [];
        // In case a device has been attached, handle the retuned valued (otherwise, this function was called during pairing)
        if (Array.isArray(this.deviceMap[deviceId])) {
          // Go through all the values
          // eslint-disable-next-line no-restricted-syntax
          for (let idx = 0; idx < gotValues.length; idx++) {
            const key = gotValues[idx].parameterId;
            const { value, strVal } = gotValues[idx];
            const valueChanged = this.confirmedDevicePoints[deviceId][key] !== undefined
              && this.confirmedDevicePoints[deviceId][key] !== value;

            // Signal the devices
            if (valueChanged) {
              for (let instanceIdx = 0; instanceIdx < this.deviceMap[deviceId].length; instanceIdx++) {
                const instance = this.deviceMap[deviceId][instanceIdx];
                const { device } = this.devices[instance];
                if (!device.killed) {
                  promises.push(device.onDevicePointChanged(key, value, strVal));
                }
              }
            }

            this.confirmedDevicePoints[deviceId][key] = value;
            // Remove gotten values from pendingDevicePoints (if they match)
            if (key in this.pendingDevicePoints[deviceId]) {
              // eslint-disable-next-line eqeqeq
              if (value == this.pendingDevicePoints[deviceId][key]) {
                this.log(`Key ${key} confirmed ${value} = ${this.pendingDevicePoints[deviceId][key]}`);
                delete this.pendingDevicePoints[deviceId][key];
              } else {
                this.log(`Key ${key} not confirmed (set value: ${this.pendingDevicePoints[deviceId][key]}, actual: ${value}`);
              }
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

  async setDevicePoint(instanceId, parameters) {
    const { deviceId, deviceDefinition } = this.devices[instanceId];
    // eslint-disable-next-line no-restricted-syntax, guard-for-in
    for (const key in parameters) {
      const devPointDef = deviceDefinition.devPointTable[key];
      // Do not set parameters that are not defined:
      // These can come from common settings that are for similar devices, but not this one
      // (as the driver.settings.compose.json can not be updated runtime)
      if (devPointDef === undefined) {
        // delete parameters[key];
        // continue;
        return Promise.reject(new Error(`Setting ${key} is not available to be set on device ${deviceId}.`));
      }
      // Round values that require rounding
      if (devPointDef.type === TYPE.NUMBER) {
        parameters[key] = Math.floor(+parameters[key] / (+devPointDef.scaleValue * +devPointDef.stepValue)) * (+devPointDef.scaleValue * +devPointDef.stepValue);
      }
      // Do not set unchanged parameters
      if (key in this.confirmedDevicePoints[deviceId]
        && !(key in this.pendingDevicePoints[deviceId])
        // eslint-disable-next-line eqeqeq
        && parameters[key] == this.confirmedDevicePoints[deviceId][key]) {
        this.log(`Ignoring setting unchanged parameter ${key} to ${parameters[key]}}`);
        delete parameters[key];
      }
    }
    if (Object.keys(parameters).length === 0) {
      return true;
    }

    this.pendingDevicePoints[deviceId] = {
      ...this.pendingDevicePoints[deviceId],
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
   * during pairing the instanceId and devicePoint will be set to null and a custom list will be attached
   */
  async getDevicePointValues(instanceId, devicePoint, customList = undefined) {
    const devpointMap = (instanceId === null) ? null : this.devices[instanceId].deviceDefinition.devPointTable;
    const devicePointSettings = customList || devpointMap[devicePoint];

    if (devicePointSettings === undefined) return [];

    const results = [];
    const {
      type, enumValues, minValue, maxValue, stepValue, scaleValue, parameterUnit
    } = devicePointSettings;
    // eslint-disable-next-line no-nested-ternary
    let step = +stepValue;
    if ((maxValue - minValue) / step > 1000) {
      step = (maxValue - minValue) / 1000;
    }
    step = Math.ceil(step / +stepValue) * +stepValue;
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
  async synchronizeStates(statesLeft, instanceId) {
    const instance = this.devices[instanceId];
    const { deviceId, deviceDefinition, device, reverseKeyMap } = instance;
    let fetchStateError;
    this.devices[instanceId].updateID = undefined;
    this.log(`Fetching states for device ${deviceId}: ${JSON.stringify(statesLeft)}`);
    try {
      const stateToFetch = statesLeft.join(',');
      let stateRequest;
      try {
        if (statesLeft.length > 0) {
          stateRequest = await this.getDevicePoints(deviceId, stateToFetch);
        } else {
          stateRequest = []; // Avoid to fetch from myUplink if no state is requested
        }
        // this.log(`State response: ${JSON.stringify(stateRequest)}`);
      } catch (innerErr) {
        throw new Error(`Network problem: ${innerErr.message}`);
      }

      const fetchedStates = {}; // States going to settings
      if (Array.isArray(stateRequest)) {
        for (let val = 0; val < stateRequest.length; val++) {
          if ('parameterId' in stateRequest[val]) {
            const { value, strVal, parameterId } = stateRequest[val];
            if (!(parameterId in reverseKeyMap)) {
              // parameters in the keymap has actions to perform below. If it's not in the keymap it's used by flows only, so ignore
              if (!(parameterId in this.doPrefetch[deviceId])) {
                // This is ok when the device driver is started, but it should not be recurrent.
                this.log(`WARNING: parameterId ${parameterId} fetched but is neither used by flows or present in device definition`);
              }
              continue;
            }
            const settingName = String(reverseKeyMap[parameterId].value);
            if (settingName.substring(0, 6) === 'status'
              || settingName.substring(0, 7) === 'setting') {
              if (instance.settingTypes[settingName] === 'number') {
                fetchedStates[settingName] = +value; // Value without unit
              } else if (instance.settingTypes[settingName] === 'dropdown') {
                fetchedStates[settingName] = `${value}`;
                // myUplink may contain invalid values, make sure that the value above was legal or remove it
                if (parameterId in deviceDefinition.devPointTable) {
                  const { enumValues } = deviceDefinition.devPointTable[parameterId];
                  if (Array.isArray(enumValues) && enumValues.length > 0) {
                    if (!(enumValues.map((a) => +a.value).includes(+value))) {
                      this.log(`WARNING: myUplink contains an invalid value ${value} for devicePoint ${parameterId} (device: ${deviceDefinition.name})`);
                      fetchedStates[settingName] = undefined;
                    }
                  }
                } else {
                  this.log(`WARNING: parameter ${parameterId} was read from myUplink but is not in the device definition for the device ${deviceDefinition.name}`);
                  this.log(`         The error occured while processing setting ${settingName}`);
                }
              } else {
                fetchedStates[settingName] = String(strVal); // Value with unit
              }
            } else if (parameterId in deviceDefinition.capTable) {
              this.log(`Setting capability: ${settingName} = ${value}`);
              const startName = settingName.substring(0, 5);
              if (startName === 'onoff' || startName === 'alarm') {
                device.setCapabilityValue(settingName, +value ? true : false);
              } else if (settingName[0] !== '$') {
                if (settingName.substring(0, 9) === 'max_power') {
                  await device.setCapabilityValue(settingName, String(value));
                } else {
                  await device.setCapabilityValue(settingName, +value);
                }
              }
            }
            // Update dependent values:
            await this.onValueUpdate(instanceId, parameterId, value);
          }
        }
      }
      await this.onValueUpdate(instanceId, 'all');

      // FW version need to be fetched separately, do this once every hour
      const now = Date.now();
      if (!this.FwTime || (now - this.FwTime > 3600000)) {
        this.FwTime = now;
        fetchedStates.firmwareVersion = 'unknown';
        const firmwareResponse = await this.getDeviceInfo(deviceId);
        if (firmwareResponse && ('firmware' in firmwareResponse) && ('currentFwVersion' in firmwareResponse.firmware)) {
          fetchedStates.firmwareVersion = String(firmwareResponse.firmware.currentFwVersion);
          this.log(`Fetched FW version: ${fetchedStates.firmwareVersion}`);
        }
      }

      if (Object.keys(fetchedStates).length > 0) {
        try {
          const oldSettings = device.getSettings();

          // eslint-disable-next-line no-restricted-syntax, guard-for-in
          for (const name in fetchedStates) {
            if (typeof fetchedStates[name] !== typeof oldSettings[name]) {
              this.log(`Incorrect type of setting ${name}: New type: ${typeof fetchedStates[name]} Old type: ${typeof oldSettings[name]}`);
            }
          }
          await device.setSettings(fetchedStates);
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
        if (!device.killed) {
          device.setUnavailable(`Error: ${fetchStateError.message}`);
          // Retry this function again in a while
          instance.errCnt++;
          refreshRate = device.getSettings().updateRateErr * Math.min(instance.errCnt, 5);
        }
      } else {
        // All device points ok
        this.log('Device points refreshed');
        device.setAvailable();
        instance.errCnt = 0;
        const { updateRate, updateRateCache, updateRateSettings } = device.getSettings();
        refreshRate = Math.max(5, Math.min(
          updateRate - instance.timeSinceCapRefresh,
          updateRateCache - instance.timeSinceCacheRefresh,
          updateRateSettings - instance.timeSinceSettingsRefresh
        ));
        instance.timeSinceCapRefresh += refreshRate;
        instance.timeSinceCacheRefresh += refreshRate;
        instance.timeSinceSettingsRefresh += refreshRate;

        // Schedule next refresh of state
        if (instance.timeSinceCapRefresh >= updateRate) {
          instance.timeSinceCapRefresh = 0;
          statesLeft = statesLeft.concat(Object.keys(deviceDefinition.capTable || {}).filter((key) => key[0] !== '$'));
          statesLeft = statesLeft.concat(Object.keys(deviceDefinition.onChange || {}).filter((key) => (key[0] !== '$' && key !== 'all')));
        }
        if (instance.timeSinceCacheRefresh >= updateRateCache) {
          // Trigger onChanged for all flows in order for myUplink cache to evaluate which devicePoints that should
          // be fetched recurrently
          await instance.device.onDevicePointChanged('updateCache', 0, '');

          instance.timeSinceCacheRefresh = 0;
          statesLeft = statesLeft.concat(Object.keys(this.doPrefetch[deviceId] || {}));
        }
        if (instance.timeSinceSettingsRefresh >= updateRateSettings) {
          instance.timeSinceSettingsRefresh = 0;
          statesLeft = statesLeft.concat(Object.keys(deviceDefinition.settingsTable  || {}).filter((key) => key[0] !== '$'));
          statesLeft = statesLeft.concat(Object.keys(deviceDefinition.statusTable  || {}).filter((key) => key[0] !== '$'));
        }
      }
      // Remove duplicates created in the concats above
      statesLeft = [...new Set(statesLeft)];

      this.log(`States to be fetched: [${statesLeft}] in ${refreshRate} s`);
      this.devices[instanceId].updateID = setTimeout(() => {
        if (device.killed) return;
        this.synchronizeStates(statesLeft, instanceId);
      }, refreshRate * 1000);
    }
  }

  /**
   * Make sure that a specific devicePoint is prefethced from myUplink
   * Caching is done per deviceId
   */
  async qualifyCache(deviceId, devicePoint) {
    if (!(deviceId in this.doPrefetch)) {
      this.doPrefetch[deviceId] = {};
    }
    if (devicePoint in this.doPrefetch[deviceId]) {
      return Promise.resolve();
    }
    this.log(`Added device point ${devicePoint} to the cache for ${deviceId}`);
    this.doPrefetch[deviceId][devicePoint] = true;
    return this.getDevicePoints(deviceId, String(devicePoint));
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

  /**
   * Initialize the device
   */
  async initDevice(device, deviceDefinition) {
    this.log(`Initializing device ${device.deviceId}`);
    // === Add device ===
    const { deviceId } = device;
    const newDevice = {
      device,
      deviceId,
      driverId: device.driver.id,
      deviceDefinition: { ...deviceDefinition },
      vars: {},             // Variables used by this instanceId
      keyMap: {},           // Filled with capabilities => myUplinkDevicePoints
      reverseKeyMap: {},    // Filled with myUplinkDevicePoints => capabilities
      errCnt: 0,
      timeSinceCapRefresh: 0,
      timeSinceCacheRefresh: 0,
      timeSinceSettingsRefresh: 0
    };
    this.devices.push(newDevice);
    if (!(deviceId in this.confirmedDevicePoints)) {
      this.confirmedDevicePoints[deviceId] = {};
      this.pendingDevicePoints[deviceId] = {};
    }

    // === Map device ===
    device.instanceId = this.devices.length - 1;
    const { instanceId } = device;
    if (!(deviceId in this.deviceMap)) {
      this.deviceMap[deviceId] = [];
    }
    this.deviceMap[deviceId].push(instanceId);
    if (this.deviceMap[deviceId].length > 1) {
      this.log(`WARNING: Device ${deviceId} is now controlled by ${this.deviceMap[deviceId].length} drivers`);
    }

    const definition = this.devices[instanceId].deviceDefinition;

    // === Generic drivers have no definition, need to generate one ===
    if (deviceDefinition.devPointTable === undefined) {
      this.log('Generic driver detected, added deviceDefinitions from myUplink (english only)');
      const devPoints = await this.getDevicePoints(deviceId, {}, 'en');
      definition.devPointTable = this.mapDevPoints(devPoints);
      definition.capTable = device.getStore().capTable;
      definition.onChange = device.getStore().onChange;
      definition.onCreated = device.getStore().onCreated;
      definition.onChange.all = {};
      device.deviceDefinition = definition;
    }

    // === Aquire the device states ===
    newDevice.doneInit = device.getStoreValue('doneInit') || false;
    newDevice.vars = device.getStoreValue('var') || {};
    this.log(`gotDoneInit: ${newDevice.doneInit}`);

    // === Prepare key maps ===
    this.log('Synchronizing states');
    newDevice.reverseKeyMap = {
      ...this.mapTable(definition.onChange, 'onChange'),
      ...this.mapTable(definition.capTable, 'cap'),
      ...this.mapTable(definition.settingsTable, 'settings'),
      ...this.mapTable(definition.statusTable, 'status'),
    };

    newDevice.keyMap = {};
    const keys = Object.keys({ ...this.mapTable(deviceDefinition.capTable, 'cap') });
    for (let keyNr = 0; keyNr < keys.length; keyNr++) {
      newDevice.keyMap[newDevice.reverseKeyMap[keys[keyNr]].value] = keys[keyNr];
    }

    // === Find the setting types to be used in synchronizeStates ===
    // The setting types are found in the driver manifest
    const driverManifest = device.homey.manifest.drivers.filter((driver) => driver.id === newDevice.driverId)[0];
    const allSettings = [];
    for (let group = 0; group < driverManifest.settings.length; group++) {
      allSettings.push(...driverManifest.settings[group].children);
    }
    newDevice.settingTypes = {};
    for (let i = 0; i < allSettings.length; i++) {
      newDevice.settingTypes[allSettings[i].id] = allSettings[i].type;
    }

    // === Set all capability values and settings ===
    const statesLeft = Object.keys(newDevice.reverseKeyMap);
    if (!newDevice.doneInit) {
      const actionQueue = ('onCreated' in definition) ? Object.keys(definition.onCreated) : {};
      for (let i = 0; i < actionQueue.length; i++) {
        const key = actionQueue[i];
        let value = definition.onCreated[key];
        if (value === '#now') value = (new Date()).getTime();
        if (key[0] === '$') {
          newDevice.vars[key] = value;
        } else {
          const newState = {};
          newState[key] = value;
          await this.setDevicePoint(instanceId, newState);
        }
      }
      await device.setStoreValue('var', newDevice.vars);
    }
    await this.synchronizeStates(statesLeft, instanceId);

    // === Add Capability listeners ===
    this.log('Adding capability listeners');
    await this.addCapListeners(device, definition.capTable);

    // === Finalizing init ===
    await device.setStoreValue('doneInit', true);
    this.log(`Device ${deviceId} fully initialized.`);
  }

  /**
   * Uninitialize an instance of a device
   */
  async unInitDevice(instanceId) {
    if (this.devices[instanceId].updateID) {
      clearTimeout(this.devices[instanceId].updateID);
      this.devices[instanceId].updateID = undefined;
    }
  }

  /**
   * Adds capability listeners for writeable devices
   */
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
          return this.onValueUpdate(device.instanceId, key, newVal, true)
            .then(() => this.onValueUpdate(device.instanceId, 'all', undefined, true));
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
  async onValueUpdate(instanceId, key, newVal = undefined, fromCap = false) {
    const { deviceDefinition, device, deviceId, vars } = this.devices[instanceId];
    const stateToSet = {};
    let varUpdated = false;

    // 1) Update the value, either the variable or myUplink directly
    //    (if the source of the change is from myUplink then ignore)
    if (fromCap) {
      if (key[0] === '$') {
        // Update the variable
        vars[key] = newVal;
        varUpdated = true;
      } else if (key !== 'all') {
        // Update myUplink
        stateToSet[key] = +newVal; // Convert true/false to 1/0
      }
    }

    // 2) If there is a task-list, execute it:
    //    Both variables and other keys may have task lists
    const taskList =  deviceDefinition.onChange[key];
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
          const value = this.confirmedDevicePoints[deviceId][found[1]];
          taskValue = taskValue.replace(found[0], value);
          found = deviceIdRegexp.exec(taskValue);
        }
        // Replace all variables in the task
        // The longest variable names are replaced first in order to avoid leftover remains of variables starting with the same text
        const varKeys = Object.keys(vars);
        for (let varidx = varKeys.length - 1; varidx >= 0; varidx--) {
          taskValue = taskValue.replace(RegExp(`\\${varKeys[varidx]}`, 'g'), vars[varKeys[varidx]]);
        }
        // Evaluate all equations
        taskValue = evaluate(taskValue) || 0;
        if (taskKey[0] === '$') {
          // Update the variable
          const capName = deviceDefinition.capTable[taskKey];
          if (capName && (vars[taskKey] !== taskValue)) {
            const startName = capName.substring(0, 5);
            if (startName === 'onoff' || startName === 'alarm') {
              console.log(`Set ${capName}    = ${+taskValue ? true : false}`);
              await device.setCapabilityValue(capName, +taskValue ? true : false);
            } else if (capName.substring(0, 9) === 'max_power') {
              await device.setCapabilityValue(capName, String(taskValue));
            } else {
              await device.setCapabilityValue(capName, +taskValue);
            }
          }
          if (vars[taskKey] !== taskValue) {
            vars[taskKey] = taskValue;
            varUpdated = true;
          }
        } else {
          // Update myUplink
          stateToSet[taskKey] = taskValue;
        }
      }
    }

    if (varUpdated) await device.setStoreValue('var', vars);
    if (fromCap) await this.setDevicePoint(instanceId, stateToSet);
    return Promise.resolve();
  }

} // myUplinkOAuth2Client

module.exports = myUplinkOAuth2Client;
