import "./style.css";
import * as d3 from "d3";
import { UofTMapVis } from "./MapVis";
import type { BuildingRow } from "./types";

export type AcademicYear = Course[];
export interface Course {
  name: string;
  code: string;
  sessions: string[];
  faculty: string;
  facultyName: string;
  campus: string;
  is_cancelled: boolean;
  breadths: Breadths;
  lecture_sections: LectureSection[];
}
export interface Breadths {
  artsc: string[];
  scar: string[];
  erin: string[];
}
export interface LectureSection {
  section_code: string;
  instructors: Instructor[];
  max_enrolment: number;
  current_enrolment: number;
  meetings: Meeting[];
}
export interface Instructor {
  firstName: string;
  lastName: string;
}
export interface Meeting {
  day: number;
  start_millis: number;
  end_millis: number;
  duration_minutes: number;
  building: string | null;
  buildingRoomNumber: never;
}

let mapVis: UofTMapVis;
let availableDesignators: string[] = [];

async function init() {
  try {
    const [mapRes, bldgRes] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}uoft_map.geojson`),
      fetch(`${import.meta.env.BASE_URL}building.csv`),
    ]);

    if (!mapRes.ok || !bldgRes.ok) throw new Error("Base data fetch failed");

    const geoJsonData = await mapRes.json();
    const buildingsText = await bldgRes.text();
    const buildingsCsv = d3.csvParse(
      buildingsText,
      (row) => row as unknown as BuildingRow,
    );

    mapVis = new UofTMapVis("app", geoJsonData, buildingsCsv);

    setupEventListeners();
    await loadYearData("20259");
    
    updateLegend();
  } catch (err) {
    console.error(err);
  }
}

async function loadYearData(year: string) {
  const errorStatus = document.getElementById("error-message")!;
  errorStatus.style.display = "none";

  try {
    const res = await fetch(`${import.meta.env.BASE_URL}courses_${year}.json`);
    if (!res.ok) throw new Error(`Could not load ${year} data`);
    const data: AcademicYear = await res.json();

    const desigs = new Set<string>();
    data.forEach(c => desigs.add(c.code.substring(0, 3).toUpperCase()));
    
    availableDesignators = Array.from(desigs).sort();

    mapVis.updateData(data);
    updateLegend(); 
  } catch (e) {
    console.error(e);
    errorStatus.innerText = `Failed to load year ${year}.`;
    errorStatus.style.display = "block";
  }
}

function updateLegend() {
  const container = document.getElementById("legend-container")!;
  if (!mapVis || mapVis.groupBy === "designator") {
    container.style.display = "none";
    return;
  }
  container.style.display = "grid";
  const items = mapVis.getLegendItems();
  
  container.innerHTML = items.map(item => {
    // Dynamic contrast border matching the chip inputs
    const isLightColor = mapVis.getContrast(item.color) === "black";
    const borderStyle = isLightColor ? "border: 1px solid #000;" : "border: 1px solid rgba(0,0,0,0.1);";
    
    return `
      <div class="legend-item">
        <div class="legend-color" style="background-color: ${item.color}; ${borderStyle}"></div>
        <span>${item.label}</span>
      </div>
    `;
  }).join('');
}

function setupChipInput(
  containerId: string,
  initialValues: string[],
  clearBtnId: string,
  onChange: (vals: string[]) => void,
  getColor?: (val: string) => string
) {
  const container = document.getElementById(containerId)!;
  const chipsEl = container.querySelector('.chips')!;
  const inputEl = container.querySelector('input')!;
  const suggEl = container.querySelector('.suggestions') as HTMLElement;
  const clearBtn = document.getElementById(clearBtnId)!;

  document.body.appendChild(suggEl);

  let values = [...initialValues];

  const render = () => {
    chipsEl.innerHTML = '';
    values.forEach(val => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      let colorHtml = '';
      if (getColor) {
        const color = getColor(val);
        const isLightColor = mapVis.getContrast(color) === "black";
        const borderStyle = isLightColor ? "border: 1px solid #000;" : "border: 1px solid rgba(0,0,0,0.1);";
        colorHtml = `<span class="chip-color-dot" style="background-color: ${color}; ${borderStyle}"></span>`;
      }
      chip.innerHTML = `${colorHtml}<span>${val}</span> <button>&times;</button>`;
      chip.querySelector('button')!.onclick = () => {
        values = values.filter(v => v !== val);
        render();
        onChange(values);
      };
      chipsEl.appendChild(chip);
    });
  };

  clearBtn.onclick = (e) => {
    values = [];
    render();
    onChange(values);
    (e.target as HTMLElement).blur();
  };

  const positionSuggestions = () => {
    const rect = container.getBoundingClientRect();
    suggEl.style.position = 'absolute';
    
    if (window.innerWidth > 768) {
      suggEl.style.top = `${rect.top + window.scrollY}px`;
      suggEl.style.left = `${rect.right + window.scrollX + 8}px`;
      suggEl.style.width = `160px`;
    } else {
      suggEl.style.top = `${rect.bottom + window.scrollY}px`;
      suggEl.style.left = `${rect.left + window.scrollX}px`;
      suggEl.style.width = `${rect.width}px`;
    }
  };

  const showSuggestions = () => {
    const query = inputEl.value.trim().toUpperCase();
    const matches = availableDesignators
      .filter(s => s.includes(query)); // Removed the slice to show all

    if (matches.length > 0 && inputEl === document.activeElement) {
      suggEl.innerHTML = matches.map(m => {
        const isAdded = values.includes(m);
        return `<div class="suggestion-item ${isAdded ? 'disabled' : ''}" data-val="${m}">${m}</div>`;
      }).join('');
      
      suggEl.style.display = 'block';
      positionSuggestions();

      suggEl.querySelectorAll('.suggestion-item:not(.disabled)').forEach(el => {
        el.addEventListener('click', () => {
          const newVal = (el as HTMLElement).dataset.val!;
          if (!values.includes(newVal)) {
            values.push(newVal);
            onChange(values);
          }
          inputEl.value = '';
          suggEl.style.display = 'none';
          render();
          inputEl.focus(); 
        });
      });
    } else {
      suggEl.style.display = 'none';
    }
  };

  inputEl.addEventListener('input', showSuggestions);
  inputEl.addEventListener('focus', showSuggestions);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      suggEl.style.display = 'none';
      inputEl.blur();
    } else if (e.key === 'Backspace' && inputEl.value === '') {
      if (values.length > 0) {
        values.pop();
        render();
        onChange(values);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const query = inputEl.value.trim().toUpperCase();

      if (values.includes(query)) {
          inputEl.value = '';
          suggEl.style.display = 'none';
          return;
      }

      if (query.length === 3 && availableDesignators.includes(query)) {
         values.push(query);
         inputEl.value = '';
         render();
         onChange(values);
         suggEl.style.display = 'none';
         return;
      }

      const firstSugg = suggEl.querySelector('.suggestion-item:not(.disabled)');
      if (firstSugg) {
        (firstSugg as HTMLElement).click();
      }
    }
  });

  const sidebar = document.getElementById('sidebar');
  sidebar?.addEventListener('scroll', () => {
    if (suggEl.style.display === 'block') positionSuggestions();
  });
  
  window.addEventListener('resize', () => {
    const isMobile = window.innerWidth <= 768;
    const isSidebarClosed = !sidebar?.classList.contains('open');
    if (isMobile && isSidebarClosed) {
      suggEl.style.display = 'none';
    } else if (suggEl.style.display === 'block') {
      positionSuggestions();
    }
  });

  document.addEventListener('pointerdown', (e) => {
    const target = e.target as Node;
    if (!container.contains(target) && !suggEl.contains(target)) {
      suggEl.style.display = 'none';
    }
  });

  window.addEventListener('close-all-suggestions', () => {
    suggEl.style.display = 'none';
  });

  render();

  return {
    setValues: (newValues: string[]) => {
      values = [...newValues];
      render();
      onChange(values);
    }
  };
}

function setupEventListeners() {
  const toggle = document.getElementById("mobile-toggle");
  const sidebar = document.getElementById("sidebar");
  toggle?.addEventListener("click", () => sidebar?.classList.toggle("open"));

  document.getElementById("year-select")?.addEventListener("change", (e) => {
    loadYearData((e.target as HTMLSelectElement).value);
  });

  const groupSelect = document.getElementById("group-by") as HTMLSelectElement;
  const designatorConfig = document.getElementById("designator-config")!;
  const filterDesigGroup = document.getElementById("filter-desig-group")!;

  const initialVal = groupSelect.value;
  designatorConfig.style.display = initialVal === "designator" ? "block" : "none";
  filterDesigGroup.style.display = initialVal === "designator" ? "none" : "block";

  groupSelect.addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value;
    mapVis.groupBy = val;
    designatorConfig.style.display = val === "designator" ? "block" : "none";
    filterDesigGroup.style.display = val === "designator" ? "none" : "block";
    updateLegend();
    mapVis.wrangleData();
  });

  const visibleDesigChips = setupChipInput(
    "visible-desig-container",
    mapVis.visibleDesignators,
    "clear-visible-desig",
    (vals) => {
      mapVis.visibleDesignators = vals;
      mapVis.wrangleData();
    },
    (val) => mapVis.getColor(val) 
  );

  document.getElementById("default-visible-desig")?.addEventListener("click", (e) => {
    visibleDesigChips.setValues([
      "MAT", "STA", "CSC", "PHY", "BIO", "AST",
      "ENG", "PHL", "LIN", "ECO", "SOC", "PSY",
    ]);
    (e.currentTarget as HTMLElement).blur();
  });

  setupChipInput(
    "filter-desig-container",
    mapVis.filterDesignators,
    "clear-filter-desig",
    (vals) => {
      mapVis.filterDesignators = vals;
      mapVis.wrangleData();
    }
  );

  document.querySelectorAll('input[name="weight"]').forEach((radio) => {
    radio.addEventListener("change", (e) => {
      mapVis.weightMode = (e.target as HTMLInputElement).value as
        | "none"
        | "students"
        | "sqrt"
        | "enrollment";
      mapVis.wrangleData();
    });
  });

  let sizeTimeout: number | undefined;
  document.getElementById("size-slider")?.addEventListener("input", (e) => {
    mapVis.sizeFactor = parseFloat((e.target as HTMLInputElement).value);
    if (sizeTimeout) window.clearTimeout(sizeTimeout);
    sizeTimeout = window.setTimeout(() => mapVis.wrangleData(), 100);
  });

  document.getElementById("text-size-slider")?.addEventListener("input", (e) => {
    mapVis.minTextVisibilityThreshold = parseFloat((e.target as HTMLInputElement).value);
    mapVis.updateLabels();
  });

  document.getElementById("concise-text")?.addEventListener("change", (e) => {
    mapVis.isConcise = (e.target as HTMLInputElement).checked;
    mapVis.wrangleData(); 
  });

  document.getElementById("hide-text")?.addEventListener("change", (e) => {
    mapVis.hideText = (e.target as HTMLInputElement).checked;
    mapVis.updateLabels();
  });

  document.getElementById("btn-reset-zoom")?.addEventListener("click", () => {
    mapVis.resetZoom();
  });

  setupFilterGroup("filter-br-all", "filter-br", (selected) => {
    mapVis.filterBreadths = selected;
    mapVis.wrangleData();
  });

  setupFilterGroup("filter-level-all", "filter-level", (selected) => {
    mapVis.filterLevels = selected;
    mapVis.wrangleData();
  });
}

function setupFilterGroup(
  allId: string,
  name: string,
  callback: (selected: string[]) => void,
) {
  const allCb = document.getElementById(allId) as HTMLInputElement;
  const cbs = document.querySelectorAll(
    `input[name="${name}"]`,
  ) as NodeListOf<HTMLInputElement>;

  allCb.addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    cbs.forEach((cb) => (cb.checked = checked));
    update();
  });

  cbs.forEach((cb) => {
    cb.addEventListener("change", () => {
      const checkedCount = Array.from(cbs).filter((c) => c.checked).length;
      if (checkedCount === 0) {
        allCb.checked = false;
        allCb.indeterminate = false;
      } else if (checkedCount === cbs.length) {
        allCb.checked = true;
        allCb.indeterminate = false;
      } else {
        allCb.checked = false;
        allCb.indeterminate = true;
      }
      update();
    });
  });

  function update() {
    const selected = Array.from(cbs)
      .filter((c) => c.checked)
      .map((c) => c.value);
    callback(selected);
  }
}

init();