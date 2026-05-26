const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1608,
    height: 748,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const consoleMessages = [];
  win.webContents.on("console-message", (_event, level, message) => {
    if (level >= 2) {
      consoleMessages.push(message);
    }
  });

  await win.loadFile(path.join(__dirname, "..", "dist", "renderer", "index.html"));
  await wait(900);

  const result = await win.webContents.executeJavaScript(`
    (() => ({
      title: document.querySelector('h1')?.textContent ?? '',
      machines: document.querySelectorAll('.machine-row').length,
      filterPanelRemoved: !document.querySelector('.filter-panel'),
      hasCommandBar: Boolean(document.querySelector('.command-bar')),
      summaryLabels: [
        ...Array.from(document.querySelectorAll('.summary-strip .metric-combo .metric-segment')).map((metric) =>
          metric.textContent?.trim() ?? ''
        ),
        ...Array.from(document.querySelectorAll('.summary-strip > .metric:not(.metric-combo)')).map((metric) =>
          metric.textContent?.trim() ?? ''
        )
      ],
      machineMetaText: Array.from(document.querySelectorAll('.machine-meta')).map((meta) =>
        meta.textContent?.trim() ?? ''
      ),
      searchPlaceholder: document.querySelector('.global-search input')?.getAttribute('placeholder') ?? '',
      hasSearch: Boolean(document.querySelector('.global-search input')),
      hasDetail: Boolean(document.querySelector('.detail-panel')),
      hasPartsPanel: Boolean(document.querySelector('.parts-panel')),
      hasSelectedDetailPanel: Boolean(document.querySelector('.selected-detail-panel')),
      contentGridColumns: getComputedStyle(document.querySelector('.content-grid')).gridTemplateColumns.split(' ').length,
      textLength: document.body.innerText.length,
      viewport: [window.innerWidth, window.innerHeight]
    }))()
  `);

  const searchScopeResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const setReactInputValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const input = document.querySelector('.global-search input');
      setReactInputValue(input, 'TOYO');
      await waitFrame();
      const machineSearchSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      const machineFilterSummary = document.querySelector('.result-title small')?.textContent ?? '';
      setReactInputValue(input, 'OMRON');
      await waitFrame();
      const brandSearchSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      setReactInputValue(input, 'PFXGP4410TAD');
      await waitFrame();
      const modelSearchSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      setReactInputValue(input, 'LD PAKING');
      await waitFrame();
      const locationSearchSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      setReactInputValue(input, 'proface');
      await waitFrame();
      const compactBrandSearchSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      setReactInputValue(input, 'P200');
      await waitFrame();
      const plantGroupSearchSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      document.querySelector('.reset-button')?.click();
      await waitFrame();
      return {
        machineSearchSummary,
        machineFilterSummary,
        brandSearchSummary,
        modelSearchSummary,
        locationSearchSummary,
        compactBrandSearchSummary,
        plantGroupSearchSummary
      };
    })()
  `);

  const filterResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const setReactInputValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const filterField = (label) => Array.from(document.querySelectorAll('.command-bar .multi-filter-field')).find((field) =>
        field.querySelector(':scope > span')?.textContent?.trim() === label
      );
      const openFilter = async (label) => {
        const field = filterField(label);
        field?.querySelector('.multi-filter-trigger')?.click();
        await waitFrame();
        return field;
      };
      const optionValues = (field) => Array.from(field?.querySelectorAll('.multi-filter-option span') ?? []).map((option) =>
        option.textContent?.trim() ?? ''
      );
      const chooseOption = async (field, value) => {
        const option = Array.from(field?.querySelectorAll('.multi-filter-option') ?? []).find((candidate) =>
          candidate.textContent?.trim() === value
        );
        option?.querySelector('input')?.click();
        await waitFrame();
        return Boolean(option);
      };
      const closeFilters = async () => {
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }));
        await waitFrame();
      };
      const labels = Array.from(document.querySelectorAll('.command-bar .field > span')).map((element) =>
        element.textContent?.trim() ?? ''
      );
      const plantField = await openFilter('Plant');
      const plantOptions = optionValues(plantField);
      await closeFilters();
      const deviceField = await openFilter('Device');
      const deviceOptions = optionValues(deviceField);
      const plcOptionSelected = await chooseOption(deviceField, 'PLC');
      await waitFrame();
      const plcSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      document.querySelector('.reset-button')?.click();
      await waitFrame();
      const brandField = await openFilter('Brand');
      const brandSearch = brandField?.querySelector('.multi-filter-search input');
      brandSearch?.focus();
      setReactInputValue(brandSearch, 'pro');
      await waitFrame();
      const brandSuggestions = optionValues(brandField);
      const profaceOptionSelected = await chooseOption(brandField, 'PROFACE');
      await waitFrame();
      const profaceSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      document.querySelector('.reset-button')?.click();
      await waitFrame();
      const plantFieldAgain = await openFilter('Plant');
      const plantOptionSelected = await chooseOption(plantFieldAgain, 'P200');
      await waitFrame();
      const p200Summary = document.querySelector('.result-title strong')?.textContent ?? '';
      document.querySelector('.reset-button')?.click();
      await waitFrame();
      const toolbarActions = Array.from(document.querySelectorAll('.toolbar button')).map((button) =>
        button.textContent?.trim() ?? ''
      );
      return {
        labels,
        multiFilterCount: document.querySelectorAll('.command-bar .multi-filter-field').length,
        plantOptions,
        deviceOptions,
        brandSearchFound: Boolean(brandSearch),
        brandSuggestions,
        plcOptionSelected,
        profaceOptionSelected,
        plantOptionSelected,
        profaceSummary,
        plcSummary,
        p200Summary,
        hasPlantDeviceBrand: JSON.stringify(labels) === JSON.stringify(['Plant', 'Device', 'Brand']),
        legacyFilterPanelRemoved: !document.querySelector('.filter-panel'),
        toolbarHasBackupRestore: toolbarActions.some((label) => label.includes('Backup')) && toolbarActions.some((label) => label.includes('Restore'))
      };
    })()
  `);

  const quickViewResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const clickMetric = async (label) => {
        const button = Array.from(document.querySelectorAll('.summary-strip .metric-button')).find((candidate) =>
          candidate.textContent?.includes(label)
        );
        button?.click();
        await waitFrame();
        return Boolean(button);
      };

      const mtStoreClicked = await clickMetric('MT store');
      const mtStoreSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      const mtStoreFilterSummary = document.querySelector('.result-title small')?.textContent ?? '';
      const mtStoreActive = Boolean(document.querySelector('.metric-button.active')?.textContent?.includes('MT store'));
      const mtStoreToggleOffClicked = await clickMetric('MT store');
      const mtStoreToggleOffSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      const mtStoreToggleOffFilterSummary = document.querySelector('.result-title small')?.textContent ?? '';
      const mtStoreToggleOffActive = Boolean(document.querySelector('.metric-button.active')?.textContent?.includes('MT store'));

      const secondHandClicked = await clickMetric('Second hand');
      const secondHandSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      const secondHandFilterSummary = document.querySelector('.result-title small')?.textContent ?? '';
      const secondHandEmpty = Boolean(document.querySelector('.empty-state'));
      const secondHandToggleOffClicked = await clickMetric('Second hand');
      const secondHandToggleOffSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      const secondHandToggleOffFilterSummary = document.querySelector('.result-title small')?.textContent ?? '';

      const sparePartsVisible = Array.from(document.querySelectorAll('.summary-strip .metric-button')).some((candidate) =>
        candidate.textContent?.includes('Spare parts')
      );

      const totalClicked = await clickMetric('Total parts');
      const totalSummary = document.querySelector('.result-title strong')?.textContent ?? '';
      const totalFilterSummary = document.querySelector('.result-title small')?.textContent ?? '';

      return {
        mtStoreClicked,
        mtStoreSummary,
        mtStoreFilterSummary,
        mtStoreActive,
        mtStoreToggleOffClicked,
        mtStoreToggleOffSummary,
        mtStoreToggleOffFilterSummary,
        mtStoreToggleOffActive,
        secondHandClicked,
        secondHandSummary,
        secondHandFilterSummary,
        secondHandEmpty,
        secondHandToggleOffClicked,
        secondHandToggleOffSummary,
        secondHandToggleOffFilterSummary,
        sparePartsVisible,
        totalClicked,
        totalSummary,
        totalFilterSummary
      };
    })()
  `);

  const selectionResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const nestedInteractiveCount = document.querySelectorAll('button input[type="checkbox"], button .select-box').length;
      document.querySelector('.select-visible')?.click();
      await waitFrame();
      const afterSelectVisibleText = document.querySelector('.selection-toolbar strong')?.textContent ?? '';
      document.querySelector('.clear-selected')?.click();
      await waitFrame();
      const checkbox = document.querySelector('.group-select input');
      checkbox?.click();
      await waitFrame();
      const afterSelect = {
        groupCheckboxFound: Boolean(checkbox),
        nestedInteractiveCount,
        selectVisibleFound: Boolean(document.querySelector('.select-visible')),
        afterSelectVisibleText,
        selectedText: document.querySelector('.selection-toolbar strong')?.textContent ?? '',
        deleteEnabled: !(document.querySelector('.delete-selected')?.disabled ?? true),
        clearEnabled: !(document.querySelector('.clear-selected')?.disabled ?? true)
      };
      document.querySelector('.clear-selected')?.click();
      await waitFrame();
      const deleteCheckbox = document.querySelector('.group-select input');
      deleteCheckbox?.click();
      await waitFrame();
      window.confirm = () => true;
      document.querySelector('.delete-selected')?.click();
      await waitFrame();
      await new Promise((resolve) => setTimeout(resolve, 350));
      return {
        ...afterSelect,
        afterClearText: document.querySelector('.selection-toolbar strong')?.textContent ?? '',
        afterClearDeleteDisabled: document.querySelector('.delete-selected')?.disabled ?? false,
        afterDeleteText: document.querySelector('.selection-toolbar strong')?.textContent ?? '',
        afterDeleteMachines: document.querySelectorAll('.machine-row').length,
        afterDeletePartsSummary: document.querySelector('.result-title strong')?.textContent ?? ''
      };
    })()
  `);

  const detailResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const secondMachine = document.querySelectorAll('.machine-content')[1];
      secondMachine?.click();
      await waitFrame();
      return {
        selectedMachine: document.querySelector('.machine-name-line strong')?.textContent ?? '',
        selectedPart: document.querySelector('.selected-card-title strong')?.textContent ?? '',
        partSectionHeading: document.querySelector('.part-section-heading strong')?.textContent ?? ''
      };
    })()
  `);

  const addResult = await win.webContents.executeJavaScript(`
    (() => {
      const button = Array.from(document.querySelectorAll('button')).find((candidate) =>
        candidate.textContent?.includes('Add part')
      );
      button?.click();
      return Boolean(button);
    })()
  `);
  await wait(250);

  const modalResult = await win.webContents.executeJavaScript(`
    (async () => {
      const waitFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const setReactInputValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const modelInput = Array.from(document.querySelectorAll('.part-modal label')).find((label) =>
        label.textContent?.includes('Model')
      )?.querySelector('input');
      setReactInputValue(modelInput, 'QA-MODEL-01');
      await waitFrame();
      const legends = Array.from(document.querySelectorAll('.part-modal legend')).map((legend) => legend.textContent?.trim() ?? '');

      return {
        addButtonFound: ${JSON.stringify(addResult)},
        modalVisible: Boolean(document.querySelector('.part-modal')),
        modalTitle: document.querySelector('.part-modal h2')?.textContent ?? '',
        hasSave: Array.from(document.querySelectorAll('.part-modal button')).some((button) =>
          button.textContent?.includes('Save')
        ),
        modelValue: modelInput?.value ?? '',
        legends,
        hasMachineFields: legends.some((legend) => legend.includes('Machine'))
      };
    })()
  `);
  await win.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  await wait(500);

  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(os.tmpdir(), "parts-manager-visual-check.png"), image.toPNG());

  if (result.title !== "Parts Manager PM") {
    throw new Error(`Unexpected title: ${result.title}`);
  }
  if (
    result.machines < 1 ||
    !result.filterPanelRemoved ||
    !result.hasCommandBar ||
    result.summaryLabels.length !== 4 ||
    result.summaryLabels.some((label) => label.includes("Spare parts")) ||
    !result.machineMetaText.some((text) => text === "Plant P200 / 1200") ||
    !result.machineMetaText.some((text) => text === "Plant P400 / 400") ||
    result.machineMetaText.some((text) => text.includes("Sheet") || text.includes("PK") || text.includes("LD PAKING")) ||
    !result.hasSearch ||
    !result.hasDetail ||
    !result.hasPartsPanel ||
    !result.hasSelectedDetailPanel ||
    result.contentGridColumns !== 3 ||
    result.textLength < 500
  ) {
    throw new Error(`Rendered UI failed smoke checks: ${JSON.stringify(result)}`);
  }
  if (
    result.searchPlaceholder !== "ค้นหา: เครื่อง / Code / Plant / Location / Device / Brand / Model" ||
    searchScopeResult.machineSearchSummary !== "1 groups / 3 parts" ||
    searchScopeResult.machineFilterSummary !== '"TOYO"' ||
    searchScopeResult.brandSearchSummary !== "1 groups / 2 parts" ||
    searchScopeResult.modelSearchSummary !== "1 groups / 1 parts" ||
    searchScopeResult.locationSearchSummary !== "1 groups / 1 parts" ||
    searchScopeResult.compactBrandSearchSummary !== "2 groups / 2 parts" ||
    searchScopeResult.plantGroupSearchSummary !== "1 groups / 3 parts"
  ) {
    throw new Error(`Search scope failed smoke checks: ${JSON.stringify({ result, searchScopeResult })}`);
  }

  if (
    !filterResult.hasPlantDeviceBrand ||
    !filterResult.legacyFilterPanelRemoved ||
    filterResult.multiFilterCount !== 3 ||
    JSON.stringify(filterResult.plantOptions) !== JSON.stringify(["P100", "P200", "P300 BC", "P300 NOC", "P400", "P600"]) ||
    JSON.stringify(filterResult.deviceOptions) !== JSON.stringify(["PLC", "HMI", "SERVO MOTOR", "SERVO DRIVE", "INVERTER", "MAIN MOTOR", "OPTION CARD"]) ||
    !filterResult.brandSearchFound ||
    !filterResult.brandSuggestions.includes("PROFACE") ||
    !filterResult.plcOptionSelected ||
    !filterResult.profaceOptionSelected ||
    !filterResult.plantOptionSelected ||
    filterResult.profaceSummary !== "2 groups / 2 parts" ||
    filterResult.plcSummary !== "1 groups / 2 parts" ||
    filterResult.p200Summary !== "1 groups / 3 parts" ||
    !filterResult.toolbarHasBackupRestore
  ) {
    throw new Error(`Filter controls failed smoke checks: ${JSON.stringify(filterResult)}`);
  }

  if (
    !quickViewResult.mtStoreClicked ||
    quickViewResult.mtStoreSummary !== "2 groups / 2 parts" ||
    quickViewResult.mtStoreFilterSummary !== "MT store" ||
    !quickViewResult.mtStoreActive ||
    !quickViewResult.mtStoreToggleOffClicked ||
    quickViewResult.mtStoreToggleOffSummary !== "2 groups / 4 parts" ||
    quickViewResult.mtStoreToggleOffFilterSummary !== "Showing all machines" ||
    quickViewResult.mtStoreToggleOffActive ||
    !quickViewResult.secondHandClicked ||
    quickViewResult.secondHandSummary !== "1 groups / 1 parts" ||
    quickViewResult.secondHandFilterSummary !== "Second hand" ||
    quickViewResult.secondHandEmpty ||
    !quickViewResult.secondHandToggleOffClicked ||
    quickViewResult.secondHandToggleOffSummary !== "2 groups / 4 parts" ||
    quickViewResult.secondHandToggleOffFilterSummary !== "Showing all machines" ||
    quickViewResult.sparePartsVisible ||
    !quickViewResult.totalClicked ||
    quickViewResult.totalSummary !== "2 groups / 4 parts" ||
    quickViewResult.totalFilterSummary !== "Showing all machines"
  ) {
    throw new Error(`Summary quick views failed smoke checks: ${JSON.stringify(quickViewResult)}`);
  }

  if (
    !selectionResult.groupCheckboxFound ||
    selectionResult.nestedInteractiveCount !== 0 ||
    !selectionResult.selectVisibleFound ||
    selectionResult.afterSelectVisibleText === "0 selected" ||
    selectionResult.selectedText === "0 selected" ||
    !selectionResult.deleteEnabled ||
    !selectionResult.clearEnabled ||
    selectionResult.afterClearText !== "0 selected" ||
    !selectionResult.afterClearDeleteDisabled ||
    selectionResult.afterDeleteText !== "0 selected" ||
    selectionResult.afterDeleteMachines !== 1
  ) {
    throw new Error(`Selection toolbar failed smoke checks: ${JSON.stringify(selectionResult)}`);
  }

  if (!detailResult.selectedMachine || !detailResult.selectedPart || !detailResult.partSectionHeading.includes("item")) {
    throw new Error(`Detail view failed smoke checks: ${JSON.stringify(detailResult)}`);
  }

  if (
    !modalResult.addButtonFound ||
    !modalResult.modalVisible ||
    modalResult.modalTitle !== "Add Part" ||
    !modalResult.hasSave ||
    modalResult.modelValue !== "QA-MODEL-01" ||
    modalResult.hasMachineFields
  ) {
    throw new Error(`Add popup failed smoke checks: ${JSON.stringify(modalResult)}`);
  }

  console.log(
    JSON.stringify(
      {
        result,
        searchScopeResult,
        filterResult,
        quickViewResult,
        selectionResult,
        detailResult,
        modalResult,
        consoleMessages: consoleMessages.slice(0, 5)
      },
      null,
      2
    )
  );
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
