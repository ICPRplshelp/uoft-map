import * as d3 from "d3";
import { type Course, type AcademicYear } from "./main";
import type { BuildingRow } from "./types";
import type { FeatureCollection, Polygon } from "geojson";
import { MapZoomHandler } from "./MapZoomHandler";

interface Building {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

interface NodeData extends d3.SimulationNodeDatum {
  id: string;
  buildingCode: string;
  category: string;
  rawHours: number;
  weightedHours: number;
  radius: number;
  color: string;
  targetX: number;
  targetY: number;
}

export class UofTMapVis {
  private parentElementId: string;
  private canvas: d3.Selection<HTMLCanvasElement, unknown, HTMLElement, any>;
  private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>;
  private container: d3.Selection<SVGGElement, unknown, HTMLElement, any>;
  private tooltip: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>;
  private projection: d3.GeoProjection;
  private simulation: d3.Simulation<NodeData, undefined>;
  private zoomHandler: MapZoomHandler;  
  private cameraBoundary: FeatureCollection<Polygon>;

  private mapData: FeatureCollection;
  private buildings: Map<string, Building>;
  public courses: AcademicYear = []; 

  // UI States
  public groupBy: string = "designator";
  public weightMode: "none" | "students" | "sqrt" | "enrollment" = "none";
  public sizeFactor: number = 1;
  public minTextVisibilityThreshold: number = 12; 
  public hideText: boolean = false;
  public isConcise: boolean = true;
  public isRotated: boolean = false;
  public visibleDesignators: string[] = [
    "MAT", "STA", "CSC", "PHY", "BIO", "AST",
    "ENG", "PHL", "LIN", "ECO", "SOC", "PSY",
  ];

  // Display configuration
  private textScaleFactor: number = 1.3;
  private currentTransform: d3.ZoomTransform = d3.zoomIdentity;
  private hoveredNode: NodeData | null = null;

  // Filter States
  public filterDesignators: string[] = [];
  public filterBreadths: string[] = [];
  public filterLevels: string[] = [];

  // Colors
  private brColors: Record<string, string> = {
    "1": "#cb3838",
    "2": "#65bbc9",
    "3": "#f7c959",
    "4": "#B6E364",
    "5": "#8541c9",
  };
  private levelColors: Record<string, string> = {
    "-": "#222222",
    "1": "#cfe992",
    "2": "#4275d4",
    "3": "#9b54ed",
    "4": "#d65f30",
    "5": "#6c6ce8",
  };
  private designatorColors: Record<string, string> = {
    "MAT": "#60daff",
    "STA": "#ee7b33",
    "CSC": "#9541e9",
    "PHY": "#7b95f3",
    "BIO": "#9dff51",
    "AST": "#3b38ff",
    "ENG": "#dc405d",
    "PHL": "#56c4f7",
    "LIN": "#e1ffff",
    "ECO": "#fabebe",
    "SOC": "#d0b442",
    "PSY": "#9df0ff",
  };
  private designatorColorScale = d3.scaleOrdinal(d3.schemeTableau10);
  private facultyColorScale = d3.scaleOrdinal(d3.schemeSet2);

  constructor(
    parentElementId: string,
    mapData: FeatureCollection,
    buildingsData: BuildingRow[],
  ) {
    this.parentElementId = parentElementId;
    this.mapData = mapData;
    this.buildings = new Map(
      buildingsData.map((b) => [b.code, { ...b, lat: +b.lat, lng: +b.lng }]),
    );

    const parent = document.getElementById(parentElementId);
    if (parent) parent.style.position = "relative";

    const parentSelection = d3.select(`#${parentElementId}`);
    parentSelection.selectAll("canvas").remove();
    parentSelection.selectAll("svg").remove();

    const width = parent?.clientWidth || window.innerWidth;
    const height = parent?.clientHeight || window.innerHeight;

    this.canvas = parentSelection
      .append("canvas")
      .attr("width", width)
      .attr("height", height)
      .style("position", "absolute")
      .style("top", "0")
      .style("left", "0")
      .style("z-index", "1");

    this.svg = d3
      .select(`#${parentElementId}`)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .style("position", "absolute")
      .style("top", "0")
      .style("left", "0")
      .style("z-index", "2")
      .style("pointer-events", "all")
      .attr("class", "map-layer");

    const defs = this.svg.append("defs");
    const filter = defs
      .append("filter")
      .attr("id", "glow")
      .attr("x", "-50%")
      .attr("y", "-50%")
      .attr("width", "200%")
      .attr("height", "200%");
    filter
      .append("feGaussianBlur")
      .attr("stdDeviation", "3")
      .attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    this.container = this.svg.append("g").style("pointer-events", "none");
    this.container.append("g").attr("class", "bubble-layer");

    this.tooltip = d3.select("body").append("div")
      .attr("class", "d3-tooltip")
      .style("position", "absolute")
      .style("background", "rgba(0,0,0,0.8)")
      .style("color", "white")
      .style("padding", "8px")
      .style("border-radius", "4px")
      .style("pointer-events", "none")
      .style("font-size", "12px")
      .style("z-index", "9999")
      .style("opacity", 0)
      .style("transition", "opacity 0.25s ease-in-out");

    this.cameraBoundary = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-79.40054, 43.65776],
                [-79.40465, 43.6679],
                [-79.38993, 43.67077],
                [-79.38574, 43.66079],
                [-79.40054, 43.65776],
              ],
            ],
          },
          properties: null,
        },
      ],
    };

    this.projection = d3
      .geoMercator()
      .fitSize([width, height], this.cameraBoundary);

    this.simulation = d3
      .forceSimulation<NodeData>()
      .force("x", d3.forceX<NodeData>((d) => d.targetX).strength(0.2))
      .force("y", d3.forceY<NodeData>((d) => d.targetY).strength(0.2))
      .force(
        "collide",
        d3.forceCollide<NodeData>((d) => d.radius + 1).iterations(2),
      );

    this.zoomHandler = new MapZoomHandler({
      svg: this.svg,
      container: this.container,
      canvas: this.canvas,
      getWidth: () => document.getElementById(this.parentElementId)?.clientWidth || window.innerWidth,
      getHeight: () => document.getElementById(this.parentElementId)?.clientHeight || window.innerHeight,
      onZoomTransform: (t) => { this.currentTransform = t; },
      hasHoveredNode: () => this.hoveredNode !== null,
      updateLabels: () => this.updateLabels(),
      updateTooltipPosition: () => this.updateTooltipPosition() 
    });

    this.svg.call(this.zoomHandler.behavior);

    this.svg.on("mousemove", (e) => {
      if (!this.simulation) return;
      
      const [mx, my] = d3.pointer(e, this.svg.node());
      const simX = this.currentTransform.invertX(mx);
      const simY = this.currentTransform.invertY(my);
      
      const threshold = 15 / this.currentTransform.k; // Reduced threshold for precision
      const nodes = this.simulation.nodes();
      
      let bestNode: NodeData | null = null;
      let minEdgeDist = Infinity;
      
      let insideNode: NodeData | null = null;
      let minInsideCenterDistSq = Infinity;

      // Prioritize nodes we are strictly inside first, fall back to closest edge within threshold
      for (const n of nodes) {
          const dx = (n.x ?? 0) - simX;
          const dy = (n.y ?? 0) - simY;
          const distSq = dx * dx + dy * dy;
          const dist = Math.sqrt(distSq);
          
          const distFromEdge = dist - n.radius;
          
          if (distFromEdge <= 0) {
              // We are physically hovering over the bubble
              if (distSq < minInsideCenterDistSq) {
                  minInsideCenterDistSq = distSq;
                  insideNode = n;
              }
          } else if (distFromEdge <= threshold) {
              // Bubble cursor: We are close to the edge of a bubble
              if (distFromEdge < minEdgeDist) {
                  minEdgeDist = distFromEdge;
                  bestNode = n;
              }
          }
      }

      // Inside Node completely overrides any proximity node
      bestNode = insideNode || bestNode;

      // Update State
      if (bestNode !== this.hoveredNode) {
          if (this.hoveredNode) {
              const oldGroup = this.container.select(`#${this.getSafeId(this.hoveredNode.id)}`);
              oldGroup.select(".visible-bubble")
                  .style("filter", null)
                  .attr("stroke", "#333")
                  .attr("stroke-width", 0.5);
          }
          
          this.hoveredNode = bestNode;
          
          if (this.hoveredNode) {
              this.svg.style("cursor", "pointer"); // Force pointer cursor visually
              
              const newGroup = this.container.select(`#${this.getSafeId(this.hoveredNode.id)}`);
              newGroup.select(".visible-bubble")
                  .style("filter", "url(#glow)")
                  .attr("stroke", "#fff")
                  .attr("stroke-width", 2);
                  
              const d = this.hoveredNode;
              let weightStr = "";
              if (this.weightMode === "none") {
                  weightStr = `Total lecture hours per week: ${Math.round(d.weightedHours * 10) / 10}`;
              } else if (this.weightMode === "enrollment") {
                  weightStr = `Total enrollment: ${Math.round(d.weightedHours)}`;
              } else if (this.weightMode === "students") {
                  weightStr = `Lec hrs/wk × Enrollment: ${Math.round(d.weightedHours)}`;
              } else if (this.weightMode === "sqrt") {
                  weightStr = `Lec hrs/wk × √Enrollment: ${Math.round(d.weightedHours)}`;
              }

              this.tooltip
                  .html(
                      `<strong>${this.buildings.get(d.buildingCode)?.name || 'Building'} (${d.buildingCode})</strong><br/>
                       Category: ${this.getTooltipCategoryText(d.category)}<br/>
                       ${weightStr}`
                  )
                  .style("opacity", 1);
              
              this.updateTooltipPosition();
          } else {
              this.svg.style("cursor", null); // Revert to map 'grab' cursor
              this.tooltip.style("opacity", 0);
          }
      }
    });

    this.svg.on("mouseleave", () => {
      if (this.hoveredNode) {
          const oldGroup = this.container.select(`#${this.getSafeId(this.hoveredNode.id)}`);
          oldGroup.select(".visible-bubble")
              .style("filter", null)
              .attr("stroke", "#333")
              .attr("stroke-width", 0.5);
          this.tooltip.style("opacity", 0);
          this.svg.style("cursor", null);
          this.hoveredNode = null;
      }
    });

    this.drawMap();
    window.addEventListener("resize", this.handleResize.bind(this));
  }

  // Helper to generate safe HTML IDs for the DOM elements
  private getSafeId(id: string) {
    return "node-" + id.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private handleResize() {
    const parent = document.getElementById(this.parentElementId);
    if (!parent) return;
    const width = parent.clientWidth || window.innerWidth;
    const height = parent.clientHeight || window.innerHeight;

    this.canvas.attr("width", width).attr("height", height);
    this.svg.attr("width", width).attr("height", height);

    this.projection.fitSize([width, height], this.cameraBoundary);
    
    this.zoomHandler.updateExtents();    
    this.drawMap();
    this.wrangleData(); 
  }

  public resetZoom() {
    this.zoomHandler.resetZoom();
  }

  public redrawMapAndNodes() {
    this.drawMap();
    this.wrangleData();
  }

  private drawMap() {
    const context = this.canvas.node()?.getContext("2d");
    if (!context) return;

    const pathGenerator = d3
      .geoPath()
      .projection(this.projection)
      .context(context);
    const width = this.canvas.node()?.width || 0;
    const height = this.canvas.node()?.height || 0;

    context.clearRect(0, 0, width, height);

    context.save();
    
    // Rotate canvas around the specified center point
    if (this.isRotated) {
      const centerNode = this.projection([-79.39653146576228, 43.66283102326167]);
      if (centerNode) {
        const [cx, cy] = centerNode;
        context.translate(cx, cy);
        context.rotate(15.700 * Math.PI / 180);
        context.translate(-cx, -cy);
      }
    }

    const sortedFeatures = [...this.mapData.features].sort((a, b) => {
      type Ta = typeof a;

      const rank = (f: Ta) =>
        f.properties?.amenity === "university"
          ? 1
          : f.properties?.leisure === "park"
            ? 2
            : f.properties?.building
              ? 3
              : f.properties?.highway
                ? 4
                : 5;
      return rank(a) - rank(b);
    });

    sortedFeatures.forEach((d) => {
      context.beginPath();
      pathGenerator(d);

      let fill = "none", stroke = "none", strokeWidth = 0;
      if (d.properties?.building) { fill = "#cbc9c5"; stroke = "#b9b7b3"; strokeWidth = 0.5; } 
      else if (d.properties?.leisure === "park") { fill = "#c8facc"; } 
      else if (d.properties?.amenity === "university") { fill = "#f2eeda"; } 
      else if (d.properties?.highway) { stroke = "#ffffff"; strokeWidth = 2.5; }

      if (fill !== "none") { context.fillStyle = fill; context.fill(); }
      if (strokeWidth > 0) {
        context.lineWidth = strokeWidth;
        context.strokeStyle = stroke;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.stroke();
      }
    });
    
    context.restore();
  }

  public updateData(newCourses: AcademicYear) {
    this.courses = newCourses;
    this.wrangleData();
  }

  public wrangleData() {
    const aggregated = new Map<
      string,
      { rawHours: number; weightedHours: number; bCode: string; cat: string }
    >();

    this.courses.forEach((course) => {
      if (course.is_cancelled) return;

      if (this.filterDesignators.length > 0 && this.groupBy !== "designator") {
        const des = course.code.substring(0, 3).toUpperCase();
        if (!this.filterDesignators.includes(des)) return;
      }

      if (this.filterBreadths.length > 0) {
        const courseBRs =
          course.breadths?.artsc?.map((b) => b.replace("BR=", "").trim()) || [];
        let hasMatch = false;
        if (courseBRs.length === 0 && this.filterBreadths.includes("None"))
          hasMatch = true;
        else if (courseBRs.some((b) => this.filterBreadths.includes(b)))
          hasMatch = true;
        if (!hasMatch) return;
      }

      if (this.filterLevels.length > 0) {
        let lvl = course.code.charAt(3);
        if (!["1", "2", "3", "4", "5"].includes(lvl)) lvl = "-";
        if (!this.filterLevels.includes(lvl)) return;
      }

      const categories = this.getCategories(course);
      if (categories.length === 0) return;

      course.lecture_sections.forEach((section) => {
        const enrollment = section.current_enrolment || 0;

        section.meetings.forEach((meeting) => {
          if (!meeting.building || !this.buildings.has(meeting.building))
            return;

          let weight = 1;
          let baseVal = meeting.duration_minutes / 60;

          if (this.weightMode === "sqrt") {
             weight = Math.sqrt(enrollment);
          } else if (this.weightMode === "students") {
             weight = enrollment;
          } else if (this.weightMode === "enrollment") {
             baseVal = 1; 
             weight = enrollment;
          }

          const weightedContrib = (baseVal * weight) / categories.length;
          const rawContrib = (meeting.duration_minutes / 60) / categories.length;

          categories.forEach((cat) => {
            const key = `${meeting.building}-${cat}`;
            if (!aggregated.has(key)) {
              aggregated.set(key, {
                rawHours: 0,
                weightedHours: 0,
                bCode: meeting.building!,
                cat,
              });
            }
            const current = aggregated.get(key)!;
            current.rawHours += rawContrib;
            current.weightedHours += weightedContrib;
          });
        });
      });
    });

    let nodes: NodeData[] = [];
    const maxWeighted =
      d3.max(Array.from(aggregated.values()), (d) => d.weightedHours) || 1;
    const sizeScale = d3
      .scaleSqrt()
      .domain([0, maxWeighted])
      .range([0, 30 * this.sizeFactor]);

    aggregated.forEach((val, key) => {
      const bData = this.buildings.get(val.bCode)!;
      let [tgtX, tgtY] = this.projection([bData.lng, bData.lat]) || [0, 0];
      
      // Calculate new target coords if the map is rotated
      if (this.isRotated) {
        const centerNode = this.projection([-79.39653146576228, 43.66283102326167]);
        if (centerNode) {
          const [cx, cy] = centerNode;
          const angle = 16.184 * Math.PI / 180;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const nx = (cos * (tgtX - cx)) - (sin * (tgtY - cy)) + cx;
          const ny = (sin * (tgtX - cx)) + (cos * (tgtY - cy)) + cy;
          tgtX = nx;
          tgtY = ny;
        }
      }

      nodes.push({
        id: key,
        buildingCode: val.bCode,
        category: val.cat,
        rawHours: val.rawHours,
        weightedHours: val.weightedHours,
        radius: Math.max(3, sizeScale(val.weightedHours)),
        color: this.getColor(val.cat),
        targetX: tgtX,
        targetY: tgtY,
        x: tgtX + (Math.random() * 10 - 5),
        y: tgtY + (Math.random() * 10 - 5),
      });
    });

    this.updateVis(nodes);
  }

  private updateVis(nodes: NodeData[]) {
    this.simulation.nodes(nodes);
    this.simulation.stop();

    for (let i = 0; i < 300; ++i) {
      this.simulation.tick();
    }

    const layer = this.container.select(".bubble-layer");
    const bubbles = layer
      .selectAll<SVGGElement, NodeData>(".node-group")
      .data(nodes, (d) => d.id);

    const bubblesEnter = bubbles
      .enter()
      .append("g")
      .attr("class", "node-group")
      .attr("id", (d) => this.getSafeId(d.id))
      .attr("transform", (d) => `translate(${d.x}, ${d.y})`);

    bubblesEnter
      .append("circle")
      .attr("class", "visible-bubble")
      .attr("stroke", "#333")
      .attr("stroke-width", 0.5)
      .attr("r", 0);

    bubblesEnter
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .style("pointer-events", "none")
      .style("opacity", 0)
      .style("font-size", "0px");

    const bubblesMerge = bubblesEnter.merge(bubbles);
    bubblesMerge.attr("id", (d) => this.getSafeId(d.id));

    bubblesMerge
      .transition()
      .duration(500)
      .attr("transform", (d) => `translate(${d.x}, ${d.y})`);

    bubblesMerge
      .select(".visible-bubble")
      .transition()
      .duration(500)
      .attr("r", (d) => d.radius)
      .attr("fill", (d) => d.color);

    bubblesMerge
      .select("text")
      .text((d) => this.getDisplayText(d.category, this.isConcise))
      .transition()
      .duration(500)
      .attr("fill", (d) => this.getContrast(d.color))
      .style(
        "font-size",
        (d) =>
          (d.radius * this.textScaleFactor) /
            Math.max(1, Math.sqrt(this.getDisplayText(d.category, this.isConcise).trim().length)) +
          "px",
      )
      .style("font-weight", "bold");

    const exitGroup = bubbles.exit();
    
    exitGroup.select(".visible-bubble").transition().duration(500).attr("r", 0);
    exitGroup.select("text").transition().duration(500).style("font-size", "0px").style("opacity", 0);
      
    exitGroup.transition().duration(500).remove();
    
    this.updateLabels();
  }
  
  public updateLabels() {
      this.container.selectAll<SVGTextElement, NodeData>(".node-group text")
        .style("opacity", (d) => this.hideText ? 0 : (d.radius * this.currentTransform.k > this.minTextVisibilityThreshold ? 1 : 0));
  }

  // Bypasses all D3 transform math by getting the browser's raw bounding box coordinates of the active bubble
  private updateTooltipPosition() {
    if (!this.hoveredNode) return;
    const tNode = this.tooltip.node();
    if (!tNode) return;

    const domElementId = this.getSafeId(this.hoveredNode.id);
    const bubbleGroup = document.getElementById(domElementId);
    if (!bubbleGroup) return;

    const rect = bubbleGroup.getBoundingClientRect();
    const tw = tNode.offsetWidth;
    const th = tNode.offsetHeight;
    
    const isNarrow = window.innerWidth <= 768;
    const bubbleCenterX = rect.left + rect.width / 2;
    const bubbleCenterY = rect.top + rect.height / 2;
    const screenCenterX = window.innerWidth / 2;

    const isCentered = Math.abs(bubbleCenterX - screenCenterX) < (window.innerWidth * 0.25);

    if (isNarrow && isCentered) {
        // Direct top/bottom positioning
        let left = bubbleCenterX + window.scrollX - (tw / 2);
        
        // Keep tooltip within horizontal bounds
        if (left < window.scrollX + 10) left = window.scrollX + 10;
        if (left + tw > window.innerWidth + window.scrollX - 10) left = window.innerWidth + window.scrollX - tw - 10;

        let top = rect.bottom + window.scrollY + 10; // Default to bottom
        
        // If it goes off the bottom of the screen, put it on top
        if (top + th > window.innerHeight + window.scrollY - 10) {
            top = rect.top + window.scrollY - th - 10;
        }
        
        this.tooltip.style("left", left + "px").style("top", top + "px");
    } else {
        // Diagonal positioning
        let left = bubbleCenterX + window.scrollX + 15;
        let top = bubbleCenterY + window.scrollY + 15;

        // Keep bounds
        if (left + tw > window.innerWidth + window.scrollX) left = bubbleCenterX + window.scrollX - tw - 15;
        if (top + th > window.innerHeight + window.scrollY) top = bubbleCenterY + window.scrollY - th - 15;

        this.tooltip.style("left", left + "px").style("top", top + "px");
    }
  }

  private getCategories(c: Course): string[] {
    const facultyMap: Record<string, string> = {
      "ARTSC": "A&S",
      "APSC": "ENG",
      "ARCLA": "ARC",
      "MUSIC": "MUS"
    };
    
    if (this.groupBy === "breadth") {
      return c.breadths?.artsc?.map((b) => b.replace("BR=", "").trim()) || [];
    }
    if (this.groupBy === "designator") {
      const des = c.code.substring(0, 3);
      return this.visibleDesignators.includes(des) ? [des] : [];
    }
    if (this.groupBy === "faculty") {
      return [facultyMap[c.faculty]??c.faculty];
    }
    if (this.groupBy === "level") {
      const lvl = c.code.charAt(3);
      if (["1", "2", "3", "4", "5"].includes(lvl)) return [lvl];
      return ["-"];
    }
    return [];
  }

  public getDisplayText(cat: string, concise: boolean): string {
    if (this.groupBy === "breadth" && cat !== "None") {
      return concise ? cat : `BR=${cat}`;
    }
    if (this.groupBy === "level" && cat !== "-") {
      return concise ? cat : `${cat}00`;
    }
    // Faculty and Designator labels remain unaffected by concise mode
    return cat;
  }

  public getTooltipCategoryText(cat: string): string {
    if (this.groupBy === "level") {
      return cat === "-" ? "Other" : `${cat}00-level`;
    }
    if (this.groupBy === "faculty") {
      const fMap: Record<string, string> = {
        "APSC": "Engineering",
        "ENG": "Engineering",
        "ARTSC": "Arts & Science",
        "A&S": "Arts & Science",
        "FIS": "Information",
        "FPEH": "Kin & Phys. Ed",
        "MUSIC": "Music",
        "MUS": "Music",
        "ARCLA": "Daniels",
        "ARC": "Daniels"

      };
      return fMap[cat] || cat;
    }
    return this.getDisplayText(cat, false);
  }

  public getColor(cat: string): string {
    if (this.groupBy === "breadth") return this.brColors[cat] || "#888";
    if (this.groupBy === "designator") return this.designatorColors[cat] || this.designatorColorScale(cat);

    const facultyMap: Record<string, string> = {
      "A&S": "ARTSC"   ,
      "ENG": "APSC"   ,
      "ARC": "ARCLA"   ,
      "MUS": "MUSIC" 
    };


    if (this.groupBy === "faculty") return this.facultyColorScale(facultyMap[cat] ?? cat);
    if (this.groupBy === "level") return this.levelColors[cat] || "#222222";
    return "#888";
  }

  public getContrast(hex: string): string {
    if (hex.indexOf("#") === 0) hex = hex.slice(1);
    if (hex.length === 3)
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    const r = parseInt(hex.slice(0, 2), 16),
      g = parseInt(hex.slice(2, 4), 16),
      b = parseInt(hex.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 128 ? "black" : "white";
  }

  public getLegendItems(): { label: string, color: string }[] {
    let items: { id: string, label: string, color: string }[] = [];
    
    if (this.groupBy === "breadth") {
      items = Object.keys(this.brColors).map(k => ({ id: k, label: `BR=${k}`, color: this.brColors[k] }));
    } 
    else if (this.groupBy === "level") {
      items = Object.keys(this.levelColors).map(k => ({ id: k, label: k === "-" ? "Other" : `${k}00-level`, color: this.levelColors[k] }));
    } 
    else if (this.groupBy === "faculty") {
      const defaultOrder = ["ARTSC", "APSC", "FIS", "FPEH", "MUSIC", "ARCLA"];
      const currentFaculties = Array.from(new Set(this.courses.map(c => c.faculty)));
      const allFaculties = Array.from(new Set([...defaultOrder, ...currentFaculties]));
      
      items = allFaculties.map(k => ({ id: k, label: this.getTooltipCategoryText(k), color: this.facultyColorScale(k) }));
    } else {
      return [];
    }

    if (this.groupBy === "faculty") {
      const order = ["ARTSC", "APSC", "FIS", "FPEH", "MUSIC", "ARCLA"];
      items.sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        if (ia === -1 && ib === -1) return a.label.localeCompare(b.label);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      });
    } else {
      items.sort((a, b) => a.label.localeCompare(b.label));
    }

    const otherIdx = items.findIndex(i => i.label === "Other");
    if (otherIdx > -1) {
      const other = items.splice(otherIdx, 1)[0];
      items.push(other);
    }

    return items.map(i => ({ label: i.label, color: i.color }));
  }
}