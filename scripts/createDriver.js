/* eslint-disable no-nested-ternary */
/* eslint-disable comma-dangle */
/* eslint-disable no-console */

'use strict';

const fs = require('fs');
const prompt = require('prompt-sync')({ sigint: true });
// const { request } = require('urllib'); // This adds 512kB (1.4MB debug) to the app

// Colors used for console output
const colReset = '\u001b[0m';
const colGreen = '\u001b[32m';
const colRed = '\u001b[31m';
const colDarkGray = '\u001b[30;1m';

/**
 * Convert readFile to promise
 */
async function readFile(fileName) {
  return new Promise((resolve, reject) => {
    fs.readFile(fileName, (err, data) => {
      if (err) reject(err);
      else resolve(JSON.parse(data));
    });
  });
}

/**
 * Convert writeFile to promise
 */
async function writeFile(fileName, json) {
  const data = `${JSON.stringify(json, null, 2)}\n`;
  return new Promise((resolve, reject) => {
    fs.writeFile(fileName, data, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Returns all the features of a given device
 */
async function findDevice(stateDump, deviceName) {
  for (let i = 0; i < stateDump.length; i++) {
    if (stateDump[i].name === deviceName) return stateDump[i].features;
  }
  return Promise.reject(new Error('Could not find the device'));
}

/**
 * Analyzes a list of features and indicate which features can be capabilities
 */
async function analyzeFeatures(allFeatures, capTable) {
  const features = [];
  const cache = {};
  for (let i = 0; i < allFeatures.length; i++) {
    const id = allFeatures[i].parameterId;
    let type = { isCap: false, name: `${colRed}Unknown${colReset} : ${allFeatures[i].parameterUnit}` };
    // Default capabilities listed here: https://apps-sdk-v3.developer.homey.app/tutorial-device-capabilities.html
    if (!Array.isArray(allFeatures[i].enumValues)) {
      type = { isCap: false, name: '????????????' };
    } else if (allFeatures[i].smartHomeCategories.includes('sh-indoorSpHeat')) {
      type = { isCap: true, name: 'target_temperature', sub: 'indoor' };
    } else if (allFeatures[i].smartHomeCategories.includes('sh-indoorSpOffsHeat')) {
      type = { isCap: true, name: 'target_temperature', sub: 'offsHeat' };
    } else if (allFeatures[i].smartHomeCategories.includes('sh-indoorSpOffsCool')) {
      type = { isCap: true, name: 'target_temperature', sub: 'offsCool' };
    } else if (allFeatures[i].smartHomeCategories.includes('sh-indoorTemp')) {
      type = { isCap: true, name: 'measure_temperature', sub: 'indoor' };
    } else if (allFeatures[i].smartHomeCategories.includes('sh-outdoorTemp')) {
      type = { isCap: true, name: 'measure_temperature', sub: 'outdoor' };
    } else if (allFeatures[i].smartHomeCategories.includes('sh-supplyTemp')) {
      type = { isCap: true, name: 'measure_temperature', sub: 'supply' };
    } else if (allFeatures[i].smartHomeCategories.includes('sh-returnTemp')) {
      type = { isCap: true, name: 'measure_temperature', sub: 'return' };
    } else if (allFeatures[i].smartHomeCategories.includes('sh-hwTemp')) {
      type = { isCap: true, name: 'measure_temperature', sub: 'hw' };
    } else if (allFeatures[i].smartHomeCategories.includes('sh-energyMetered')) {
      type = { isCap: true, name: 'meter_power' };
    } else if (allFeatures[i].smartHomeCategories.includes('sh-hwBoost')) {
      type = { isCap: true, name: 'onoff.hwBoost' };
    } else if (allFeatures[i].smartHomeCategories.includes('sh-ventBoost')) {
      type = { isCap: true, name: 'onoff.ventBoost' };
    } else if ((allFeatures[i].smartHomeCategories.length > 0)
      && (allFeatures[i].smartHomeCategories[0] !== 'sh-zoneMode')) {
      throw new Error(`Unhandled smart home category: '${allFeatures[i].smartHomeCategories}'`);
    } else if (allFeatures[i].parameterUnit === '°C') {
      type = {
        isCap: allFeatures[i].parameterName.en === 'Temperature' || allFeatures[i].parameterName.en === 'Setpoint',
        name: allFeatures[i].writable ? 'target_temperature' : 'measure_temperature'
      };
    } else if (allFeatures[i].parameterUnit === 'kWh') {
      type = { isCap: false, name: allFeatures[i].writable ? '??? power' : 'meter_power' };
    } else if ((allFeatures[i].parameterUnit === 'W') || (allFeatures[i].parameterUnit === 'kW')) {
      type = { isCap: allFeatures[i].zoneId !== null, name: allFeatures[i].writable ? '??? power' : 'measure_power' };
    } else if (allFeatures[i].enumValues.length > 0) {
      type = { isCap: false, name: allFeatures[i].writable ? 'target_enum' : 'measure_enum' };
    } else if (allFeatures[i].parameterUnit === 'min') {
      type = { isCap: false, name: allFeatures[i].writable ? 'target_time' : 'measure_time' };
    } else if (allFeatures[i].parameterUnit === 'A') {
      type = { isCap: false, name: allFeatures[i].writable ? 'target_current' : 'measure_current' };
    } else if (allFeatures[i].parameterUnit === '%') {
      type = { isCap: false, name: allFeatures[i].writable ? '??? humidity' : 'measure_humidity' };
    } else if (allFeatures[i].parameterUnit === 'l') {
      type = { isCap: false, name: allFeatures[i].writable ? '??? liter' : 'measure_level' };
    } else if (allFeatures[i].parameterUnit === 'h') {
      type = { isCap: false, name: allFeatures[i].writable ? '??? hours' : 'measure_hours' };
    } else if (allFeatures[i].parameterUnit === 'hour') {
      type = { isCap: false, name: allFeatures[i].writable ? '??? hour2' : 'measure_hours2' };
    } else if (allFeatures[i].parameterUnit === 'day') {
      type = { isCap: false, name: allFeatures[i].writable ? '??? day' : 'measure_day' };
    } else if (allFeatures[i].parameterUnit === 'week') {
      type = { isCap: false, name: allFeatures[i].writable ? '??? week' : 'measure_week' };
    } else if (allFeatures[i].parameterUnit === 'l/m') {
      type = { isCap: false, name: allFeatures[i].writable ? '??? flow' : 'measure_flow' };
    } else if (allFeatures[i].parameterUnit === 'Hz') {
      type = { isCap: false, name: allFeatures[i].writable ? '???1 frequency' : '???2 frequency' };
    } else if (allFeatures[i].parameterUnit === 'DM') {
      type = { isCap: false, name: allFeatures[i].writable ? '???1 DM' : '???2 DM' };
    } else if (allFeatures[i].parameterUnit === 'Ws') {
      type = { isCap: false, name: allFeatures[i].writable ? '???1 Ws' : '???2 Ws' };
    } else if (allFeatures[i].parameterUnit === '') {
      type = { isCap: false, name: allFeatures[i].writable ? '???1 null' : '???2 null' };
    }
    if (cache[type.name] === undefined) {
      cache[type.name] = { cap: 0, nocap: 0 };
    }
    cache[type.name][type.isCap ? 'cap' : 'nocap']++;
    const cachedIdx = cache[type.name][type.isCap ? 'cap' : 'nocap'];
    if (capTable[id]) {
      type.name = capTable[id];
    } else if (type.name.includes('.')) {
      type.name = `${type.name}${cache[type.name]['cap'] + cache[type.name]['nocap']}`;
    } else if (cachedIdx > 1 || !type.isCap) {
      const subName = type.sub || (type.isCap ? 'sub' : 'ignore');
      type.name = `${type.name}.${subName}${cachedIdx}`;
    }
    features.push({ ...type, id, i });
  }
  // Add capabilities based on variables
  const capKeys = Object.keys(capTable);
  for (let i = 0; i < capKeys.length; i++) {
    if (capKeys[i][0] === '$') {
      features.push({ isCap: true, name: capTable[capKeys[i]], id: capKeys[i], i: null });
    }
  }
  return features;
}

/**
 * This class can be extended to fetch data directly from myUplink.
 * For the time being this must be input from a file fetched with another script,
 * Thus, this class is unused for now.
 */
/* class MyUplinkConnection {

  constructor() {
    this.API_URL = 'https://api.myuplink.com/v2';
    this.TOKEN_URL = 'https://api.myuplink.com/oauth/token';
    this.AUTHORIZATION_URL = 'https://api.myuplink.com/oauth/authorize';
    this.SCOPES = ['READSYSTEM WRITESYSTEM offline_access'];
    this.initialized = false;
  }

  async initialize() {
    this.env = await readFile('./env.json');
    console.log(this.env);
    this.initialized = true;
  }

  async connect() {
    await this.initialize();
    console.log('connect');
    const URL = `${this.AUTHORIZATION_URL}?response_type=code&client_id=${this.env.CLIENT_ID}&scope=${this.env.SCOPES}`;
    console.log(URL);
    // https://cloud.digitalocean.com/v1/oauth/authorize?response_type=code&client_id=CLIENT_ID&redirect_uri=null&scope=$
    const { data, res } = await request(URL, { dataType: 'http' });
    if (res.status === 200) {
      console.log('Result:');
      console.log(res);
      console.log('---------------------');
      console.log(JSON.stringify(data));
    } else {
      console.log(`Unknown response code: ${res.status}`);
    }
  }

} */

async function printHelp() {
  const helpText = 'This is a helper file to create a driver for a particular device.\n'
    + 'Usage:\n'
    + '  createDriver [driverName] [myUplinkDumpFile]\n'
    + '\n'
    + 'Output file:\n'
    + '  drivers/[driverName]/*\n'
    + '\n'
    + 'Example:\n'
    + '  createDriver Connected200 rawdata/dumpfile.json'
    + '\n'
    + 'The files are created based on the following definitions:\n'
    + '  drivers/[driverName]/deviceDefinition.js\n'
    + '  (if this file is nonexisting it will be created automatically), \n'
    + '\n'
    + '[myUplinkDumpFile] - can be fetched by using the script ./myUplinkDump.sh > [myUplinkDumpFile]';
  console.log(helpText);
}

function logProgress(item, what, statusIdx) {
  const status = [
    `${colGreen}OK${colReset}`,
    `${colRed}ERROR${colReset}`,
    `${colDarkGray}Please Update${colReset}`,
    `${colDarkGray}Please Check${colReset}`
  ];
  console.log(`[${colDarkGray}${item.padEnd(10)}${colReset}]: ${what.padEnd(70)} - ${status[statusIdx]}`);
}

function askForNumber(text, min, max) {
  let answer;
  while (answer === undefined || answer < min || answer > max) {
    answer = Number(prompt(`${text} [${min},${max}]? `));
  }
  return answer;
}

/**
 * Creates the settings file
 */
async function createSettings(driver, stateFile) {
  // const myUplink = new MyUplinkConnection();
  // myUplink.connect();

  // 1) Create Driver directories
  const driverDir = `drivers/${driver}`;
  const allDirs = [
    `${driverDir}`,
    `${driverDir}/assets`,
    `${driverDir}/assets/images`
  ];
  for (let i = 0; i < allDirs.length; i++) {
    const curDir = allDirs[i];
    if (fs.existsSync(curDir)) {
      logProgress('Dir', `Found '${curDir}'`, 0);
    } else {
      logProgress('Dir', `Created '${curDir}'`, 0);
      fs.mkdirSync(curDir);
    }
  }

  // 2) Read myUplink dump
  let stateDump;
  if (fs.existsSync(stateFile)) {
    logProgress('Dump', `Found '${stateFile}'`, 0);
    stateDump = await readFile(stateFile);
  } else {
    logProgress('Dump', `Could not find file '${stateFile}'`, 1);
    return -1;
  }

  // 3) Check for deviceDefinition
  let inData;
  const inFile = `${driverDir}/deviceDefinition.json`;
  if (fs.existsSync(inFile)) {
    logProgress('Definition', `Found '${inFile}'`, 0);
    inData = await readFile(inFile);
  } else if (stateDump.length > 0) {
    console.log('Found the following devices:');
    for (let i = 0; i < stateDump.length; i++) {
      console.log(`  [${i}]: ${stateDump[i].name}`);
    }
    const selected = askForNumber('Enter the number of the device you want to base the driver on', 0, stateDump.length - 1);

    logProgress('Definition', `Created '${inFile}'`, 2);
    inData = {
      name: driver,
      driverId: driver,
      basedOnHelp: 'The basedOn is the deviceId of a device you want to use the myUplink dump for to create the dump',
      basedOn: stateDump[selected].name,
      filterHelp: 'The filter identifies which devices are of this type',
      filter: { deviceName: stateDump[selected].data.deviceName },
      onChangeHelp: 'How to affect variables when an ID or variable changes',
      onChange: {
        ONOFFID: {
          $onOff: '#ONOFFID ? 1 : 0',
          $power: '#ONOFFID ? #ONOFFID : $power'
        },
        $onOff: {
          ONOFFID: '$onOff ? $power : 0'
        },
        $power: {
          ONOFFID: '$onOff ? $power : 0'
        }
      },
      capHelp: 'The capability Table is used to automatically create capabilities and link it to its respective identifiers in myUplink',
      capTable: {
        $onOff: 'onoff',
        $power: 'max_power_2000',
      },
      settingsHelp: 'The settings table is used to expose myUplink features as settings',
      settingsTable: {},
      statusHelp: 'The status table is used to expose myUplink features as status',
      statusTable: {},
      ignoredHelp: 'The ignored table list capabilities that are not exposed at all',
      ignoredTable: {}
    };
    // Add default caps
    const allTempFeatures = await findDevice(stateDump, stateDump[selected].name);
    const tempFeatures = await analyzeFeatures(allTempFeatures, inData.capTable);
    for (let i = 0; i < tempFeatures.length; i++) {
      const type = tempFeatures[i];
      if (type.isCap) {
        inData.capTable[`${type.id}`] = type.name;
      } else {
        let capType;
        if (Number.isFinite(allTempFeatures[type.i].value) && allTempFeatures[type.i].enumValues.length === 0) {
          capType = 'number';
        } else if (Number.isFinite(allTempFeatures[type.i].value)) {
          capType = 'dropdown';
        } else {
          capType = undefined;
        }
        if (capType === undefined) {
          inData.ignoredTable[`${type.id}`] = `ignored_${type.id}`;
        } else if (allTempFeatures[type.i].writable) {
          inData.settingsTable[`${type.id}`] = `setting_${type.id}`;
        } else {
          inData.statusTable[`${type.id}`] = `status_${type.id}`;
        }
      }
    }
  } else {
    logProgress('Definition', `Could not find devices in '${stateFile}'`, 1);
    return -1;
  }

  // Replace devicePoint description
  const allFeatures = await findDevice(stateDump, inData.basedOn);
  const TYPE = {
    UNKNOWN: null,
    NUMBER: 1,
    ENUM: 2
  };
  inData.devPointTable = {};
  for (let i = 0; i < allFeatures.length; i++) {
    // Skipped: category, timestamp, value, strVal, smartHomeCategories, zoneId
    const {
      value,
      parameterId, parameterName, parameterUnit, writable, minValue, maxValue, enumValues, scaleValue
    } = allFeatures[i];
    const type = (Number.isFinite(value) && enumValues.length === 0) ? TYPE.NUMBER
      : (Number.isFinite(value)) ? TYPE.ENUM : TYPE.UNKNOWN;
    inData.devPointTable[parameterId] = {
      parameterName,
      parameterUnit,
      writable,
      minValue,
      maxValue,
      enumValues,
      scaleValue,
      type
    };
  }
  await writeFile(inFile, inData);

  // 4) Check for all the assets
  const assetFiles = [
    'assets/images/small.png',
    'assets/images/large.png',
    'assets/images/xlarge.png',
    'assets/icon.svg'
  ];
  for (let i = 0; i < assetFiles.length; i++) {
    const asset = `${driverDir}/${assetFiles[i]}`;
    if (fs.existsSync(asset)) {
      logProgress('Image', `Found '${asset}'`, 0);
    } else {
      const srcFile = `drivers/generic/${assetFiles[i]}`;
      fs.copyFileSync(srcFile, asset);
      logProgress('Image', `Created '${asset}'`, 2);
    }
  }

  // 5) Link up the driver + device
  const links = [
    'driver.js',
    'device.js'
  ];
  for (let i = 0; i < links.length; i++) {
    const driverFile = `${driverDir}/${links[i]}`;
    if (fs.existsSync(driverFile)) {
      logProgress('Driver', `Found '${driverFile}'`, 0);
    } else {
      const driverSrc = `lib/common${links[i].charAt(0).toUpperCase() + links[i].slice(1)}`;
      fs.linkSync(driverSrc, driverFile);
      logProgress('Driver', `Linked '${driverFile}'`, 0);
    }
  }

  // 6) Classify all features and write feature files
  const features = await analyzeFeatures(allFeatures, inData.capTable);

  const outSettingsData = [
    {
      type: 'group',
      label: {
        en: 'Settings',
        no: 'Innstillinger'
      },
      children: [
      ]
    },
    {
      type: 'group',
      label: {
        en: 'Status',
        no: 'Status'
      },
      children: []
    },
    {
      type: 'group',
      label: {
        en: 'System',
        no: 'System'
      },
      children: [
        {
          id: 'firmwareVersion',
          type: 'label',
          label: {
            en: 'Firmware Version',
            no: 'Fastvareversjon'
          },
          value: '???',
          hint: {
            en: 'The Firmware version of the tank.',
            no: 'Fastvareversjonen til tanken.'
          }
        },
        {
          id: 'updateRate',
          type: 'number',
          label: {
            en: 'Refresh rate for capabilities',
            no: 'Oppdateringsfrekvens for egenskaper'
          },
          hint: {
            en: 'Number of seconds between every refresh of the capabilities.',
            no: 'Antall sekunder mellom hver oppdatering av enhetens egenskaper.'
          },
          value: 5 * 60,
          min: 5,
          max: 10 * 60,
          units: { en: 's' },
        },
        {
          id: 'updateRateSettings',
          type: 'number',
          label: {
            en: 'Refresh rate for settings',
            no: 'Oppdateringsfrekvens for innstillinger'
          },
          hint: {
            en: 'Number of seconds between every refresh of the settings.',
            no: 'Antall sekunder mellom hver oppdatering av innstillingene.'
          },
          value: 5 * 60,
          min: 1 * 60,
          max: 30 * 60,
          units: { en: 's' },
        },
        {
          id: 'updateRateErr',
          type: 'number',
          label: {
            en: 'Waiting time after errors',
            no: 'Ventetid ved feil'
          },
          hint: {
            en: 'Number of seconds to wait before retrying after a communication error with myUplink.',
            no: 'Antall sekunder å vente før neste forsøk etter en kommunikasjonsfeil mot myUplink.'
          },
          value: 5 * 60,
          min: 1 * 60,
          max: 30 * 60,
          units: { en: 's' },
        }
      ]
    }
  ];
  const outDriverData = {
    id: driver,
    name: { en: inData.name },
    platforms: ['local', 'cloud'],
    connectivity: ['cloud'],
    class: 'heater',
    capabilities: [],
    capabilitiesOptions: {
    },
    $extends: [
      'defaults',
      'default-pairing'
    ]
  };

  // console.log('+-------+-------+-------------------------------+---------------------+-----------------------------------------------+');
  // console.log('|   ID  | Cap   | Cap type                      | Smarthome group     | Description                                   |');
  // console.log('+-------+-------+-------------------------------+---------------------+-----------------------------------------------+');
  const capOrder = Object.keys(features).sort((a, b) => ((features[a].name > features[b].name) ? 1 : -1));
  for (let i = 0; i < features.length; i++) {
    const type = features[capOrder[i]];
    const { capTable, settingsTable, statusTable, ignoredTable, onChange } = inData;
    if (type.id in ignoredTable) {
      continue;
    } else if (type.id in capTable) {
      if (capTable[type.id][0] !== '$') {
        const newCapOptions = {};
        if (type.i !== null) {
          newCapOptions['title'] = allFeatures[type.i].parameterName;
          if (('minValue' in allFeatures[type.i]) && (allFeatures[type.i].minValue !== null)) {
            newCapOptions['step'] = 1; // +allFeatures[type.i].scaleValue;
            newCapOptions['min'] = allFeatures[type.i].minValue * +allFeatures[type.i].scaleValue;
            newCapOptions['max'] = allFeatures[type.i].maxValue * +allFeatures[type.i].scaleValue;
          }
          if (allFeatures[type.i].parameterUnit) {
            newCapOptions['units'] = allFeatures[type.i].parameterUnit;
          }
        } else {
          newCapOptions['title'] = { en: 'TODO Capability name' };
        }
        outDriverData.capabilitiesOptions[type.name] = newCapOptions;

        if (capTable[type.id].substring(0, 5) === 'onoff') {
          newCapOptions['insightsTitleTrue'] = { en: 'TODO Turned On' };
          newCapOptions['insightsTitleFalse'] = { en: 'TODO Turned Off' };
        }
        outDriverData.capabilities.push(type.name);
        if (!type.isCap) {
          console.log(`Warning: Adding non-default capability for myUplink setting ${type.id} : ${type.name}`);
        }
      }
      // else : Ignoring variable setting, this is code controlled, not capability controlled.
    } else if (type.id in settingsTable || type.id in statusTable) {
      const idx = (type.id in settingsTable) ? 0 : 1;
      if (idx === 0 && !allFeatures[type.i].writable) {
        console.log(`Warning: myUplink setting ${type.id} set as setting but is not writeable`);
      }
      let childrenCap = {};
      if (idx === 1) {
        childrenCap = {
          id: `status_${type.id}`,
          type: 'label',
          value: '', // allFeatures[type.i].value,
        };
      } else if (Number.isFinite(allFeatures[type.i].value) && allFeatures[type.i].enumValues.length === 0) {
        childrenCap = {
          id: `setting_${type.id}`,
          type: 'number',
          value: 0, // allFeatures[type.i].value,
          min: allFeatures[type.i].minValue * +allFeatures[type.i].scaleValue,
          max: allFeatures[type.i].maxValue * +allFeatures[type.i].scaleValue,
          step: +allFeatures[type.i].scaleValue,
          units: { en: allFeatures[type.i].parameterUnit },
        };
      } else if (Number.isFinite(allFeatures[type.i].value)) {
        const enumvalues = [];
        for (let enumIdx = 0; enumIdx < allFeatures[type.i].enumValues.length; enumIdx++) {
          enumvalues.push({
            id: String(allFeatures[type.i].enumValues[enumIdx].value),
            label: allFeatures[type.i].enumValues[enumIdx].text
          });
        }
        childrenCap = {
          id: `setting_${type.id}`,
          type: 'dropdown',
          value: '', // String(allFeatures[type.i].value),
          values: enumvalues
        };
      } else {
        console.log(allFeatures[type.i]);
        throw new Error(`Unknown data type for ${type.name}`);
      }
      childrenCap.label = allFeatures[type.i].parameterName;
      childrenCap.hint = { en: '' };
      outSettingsData[idx].children.push(childrenCap);
    } else if (type.id in onChange) {
      // ignore
    } else {
      throw new Error(`myUplink setting ${type.id} has not been defined in the deviceDefinition.json`);
    }

    // const cat = allFeatures[i].smartHomeCategories;
    // const parameterName = typeof allFeatures[i].parameterName === 'object' ? allFeatures[i].parameterName.en : allFeatures[i].parameterName;
    // console.log(`| ${String(type.id).padStart(5)} | ${String(type.isCap).padStart(5, ' ')} | ${String(type.name).padEnd(29, ' ')} `
    //           + `| ${String(cat).padEnd(19, ' ')} | ${String(parameterName).padEnd(45, ' ')} |`);
  }
  // console.log('+-------+-------+-------------------------------+---------------------+-----------------------------------------------+');

  const outSettingsFile = `${driverDir}/driver.settings.compose.json`;
  await writeFile(outSettingsFile, outSettingsData);
  logProgress('Settings', `Created '${outSettingsFile}'`, 0);

  const outDriverFile = `${driverDir}/driver.compose.json`;
  await writeFile(outDriverFile, outDriverData);
  logProgress('Settings', `Created '${outDriverFile}'`, 0);

  // 7) Update flows
  const flowFiles = [
    'actions/set_devicepoint.json',
    'actions/set_devicepoint_numeric.json',
    'conditions/devicepoint_is.json',
    'triggers/devicepoint_changed.json'
  ];
  for (let i = 0; i < flowFiles.length; i++) {
    const flowFile = `.homeycompose/flow/${flowFiles[i]}`;
    if (!fs.existsSync(flowFile)) {
      logProgress('Flow', `Could not find file '${flowFile}'`, 1);
      return -1;
    }
    const flowData = await readFile(flowFile);
    let foundfilter = false;
    for (let arg = 0; arg < flowData.args.length; arg++) {
      if ('filter' in flowData.args[arg]) {
        foundfilter = true;
        if (String(flowData.args[arg].filter).includes(driver)) {
          logProgress('Flow', `Connected '${flowFile}'`, 0);
        } else {
          logProgress('Flow', `Updated filter '${flowFile}'`, 3);
          flowData.args[arg].filter += `|${driver}`;
        }
      }
    }
    if (foundfilter) {
      await writeFile(flowFile, flowData);
    } else {
      logProgress('Flow', `Failed updating filter '${flowFile}'`, 1);
    }
  }

  return 0;
}

if (process.argv.length === 4) {
  const driver = process.argv[2];
  const stateFile = process.argv[3];

  createSettings(driver, stateFile);
} else {
  printHelp();
}
