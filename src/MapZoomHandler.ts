import * as d3 from "d3";

export interface ZoomConfig {
  svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, any>;
  container: d3.Selection<SVGGElement, unknown, HTMLElement, any>;
  canvas: d3.Selection<HTMLCanvasElement, unknown, HTMLElement, any>;
  getWidth: () => number;
  getHeight: () => number;
  onZoomTransform: (transform: d3.ZoomTransform) => void;
  hasHoveredNode: () => boolean;
  updateLabels: () => void;
  updateTooltipPosition: () => void;
}

export class MapZoomHandler {
  public behavior: d3.ZoomBehavior<SVGSVGElement, unknown>;
  private config: ZoomConfig;

  constructor(config: ZoomConfig) {
    this.config = config;
    
    this.behavior = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 8])
      .on("zoom", this.handleZoom.bind(this))
      .on("start", this.handleStart.bind(this))
      .on("end", this.handleEnd.bind(this));

    this.updateExtents();
  }

  public updateExtents() {
    const width = this.config.getWidth();
    const height = this.config.getHeight();
    this.behavior.translateExtent([[-width, -height], [width * 2, height * 2]]);
  }

  public resetZoom() {
    this.config.svg
      .transition()
      .duration(750)
      .call(this.behavior.transform, d3.zoomIdentity);
  }

  private handleZoom(e: d3.D3ZoomEvent<SVGSVGElement, unknown>) {
    const transform = e.transform;
    
    
    this.config.onZoomTransform(transform);

    
    this.config.container.attr("transform", transform as any);
    
    
    this.config.canvas.style(
      "transform",
      `translate(${transform.x}px, ${transform.y}px) scale(${transform.k})`
    );
    this.config.canvas.style("transform-origin", "0 0");

    
    this.config.updateLabels();
    
    
    if (this.config.hasHoveredNode()) {
      this.config.updateTooltipPosition();
    }
  }

  private handleStart() {
    this.config.svg.classed("grabbing", true);
    this.config.svg.style("cursor", "grabbing");
    window.dispatchEvent(new Event('close-all-suggestions')); 
  }

  private handleEnd() {
    this.config.svg.classed("grabbing", false);
    this.config.svg.style("cursor", null); 
  }
}