import { findAncestor, findAncestorP } from "./utils";
import { Line } from "./node";

const TOOLTIP_TIMEOUT = 500;

// ID of the timeout used to delay showing the tooltip on mouseover.
let timeoutId: number = null;
// The currently visible tooltip, if one is shown; Otherwise, null.
let currentTooltip: HTMLElement = null;
// X & Y coordinates of the mouse cursor
let cursorX: number = 0;
let cursorY: number = 0;

function initTooltip(container: Element) {
    disableCssTooltips(container);
    trackMousePosition();

    let nodes = container.querySelectorAll(".qp-node");
    for (let i = 0; i < nodes.length; i++) {
        addTooltip(nodes[i], e => <HTMLElement>e.querySelector(".qp-tt").cloneNode(true));
    }

    let lines = container.getElementsByTagName("polyline");
    for (let i = 0; i < lines.length; i++) {
        let line = new Line(lines[i]);
        addTooltip(line.element, e => {
            return buildLineTooltip(line);
        });
    }
}

function addTooltip(node: Element, createTooltip: (e: Element) => HTMLElement) {
    node.addEventListener("mouseover", () => onMouseover(node, createTooltip));
    node.addEventListener("mouseout", (event: MouseEvent) => onMouseout(node, event));
}

function disableCssTooltips(container: Element) {
    let root = container.querySelector(".qp-root");
    root.className += " qp-noCssTooltip";
}

function trackMousePosition() {
    document.onmousemove = e => {
        cursorX = e.pageX;
        cursorY = e.pageY;
    }
}

function onMouseover(node: Element, createTooltip: (e: Element) => HTMLElement) {
    if (timeoutId != null) return;
    timeoutId = window.setTimeout(() => {
        var tooltip = createTooltip(node);
        if (tooltip != null) showTooltip(node, tooltip);
    }, TOOLTIP_TIMEOUT);
}

function onMouseout(node: Element, event: MouseEvent) {
    // http://stackoverflow.com/questions/4697758/prevent-onmouseout-when-hovering-child-element-of-the-parent-absolute-div-withou
    let e = event.toElement || event.relatedTarget as Element;
    // If the element currently under the mouse is still the node, don't hide the tooltip
    if (e == node || e == currentTooltip) return;
    // If the mouse hovers over child elements (e.g. the text in the tooltip or the text / icons in the node) then a mouseoout
    // event is raised even though the mouse is still contained inside the node / tooltip. Search ancestors and don't hide the
    // tooltip if this is the case
    if (findAncestorP(e, x => x == node)) return;
    if (findAncestorP(e, x => x == currentTooltip)) return;
    window.clearTimeout(timeoutId);
    timeoutId = null;
    hideTooltip();
}

function showTooltip(node: Element, tooltip: HTMLElement) {
    hideTooltip();
    
    // Hide tooltip during measurement to prevent flash
    tooltip.style.visibility = "hidden";
    tooltip.style.position = "absolute";
    
    // Append tooltip to body first to get its actual height
    currentTooltip = tooltip;
    document.body.appendChild(currentTooltip);
    
    // Calculate available viewport height (accounting for status bar)
    const statusBarHeight = 42; // 2.6rem in pixels
    const viewportHeight = window.innerHeight;
    const availableHeight = viewportHeight - statusBarHeight;
    
    // Get tooltip height after it's in the DOM
    let tooltipHeight = tooltip.offsetHeight;
    const maxTooltipHeight = availableHeight - 20; // 20px margin
    
    // If tooltip is too tall, limit its height and make it scrollable
    if (tooltipHeight > maxTooltipHeight) {
        tooltip.style.maxHeight = maxTooltipHeight + "px";
        tooltip.style.overflowY = "auto";
        tooltipHeight = maxTooltipHeight; // Update to actual constrained height
    }
    
    // Convert pageY (document-relative) to viewport-relative position
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;
    const cursorViewportY = cursorY - scrollY;
    
    // Calculate space above and below cursor in viewport
    const spaceBelow = availableHeight - cursorViewportY;
    const spaceAbove = cursorViewportY;
    
    let positionY = cursorY; // Start with page-relative position
    
    // Decide positioning: prefer below cursor, but move above if not enough space
    if (spaceBelow < tooltipHeight + 10 && spaceAbove > tooltipHeight + 10) {
        // Not enough space below, but enough above - position above cursor
        positionY = cursorY - tooltipHeight - 10;
    } else if (spaceBelow < tooltipHeight + 10 && spaceAbove < tooltipHeight + 10) {
        // Not enough space above or below - position at top of viewport with scrolling
        positionY = scrollY + 10;
        tooltip.style.maxHeight = (availableHeight - 20) + "px";
        tooltip.style.overflowY = "auto";
    }
    
    // Ensure tooltip doesn't go above viewport top
    if (positionY < scrollY + 10) {
        positionY = scrollY + 10;
    }
    
    // Ensure tooltip doesn't extend below viewport bottom
    const tooltipBottom = positionY + tooltipHeight;
    const viewportBottom = scrollY + availableHeight;
    if (tooltipBottom > viewportBottom) {
        positionY = viewportBottom - tooltipHeight - 10;
        // Final safety check
        if (positionY < scrollY + 10) {
            positionY = scrollY + 10;
            tooltip.style.maxHeight = (availableHeight - 20) + "px";
            tooltip.style.overflowY = "auto";
        }
    }

    // Set final position
    currentTooltip.style.left = cursorX + "px";
    currentTooltip.style.top = positionY + "px";
    
    // Make tooltip visible after positioning
    currentTooltip.style.visibility = "visible";
    
    currentTooltip.addEventListener("mouseout", function (event) {
        onMouseout(node, event);
    });
}

function getDocumentHeight() {
    // http://stackoverflow.com/a/1147768/113141
    let body = document.body,
        html = document.documentElement;
    return Math.max(
        body.scrollHeight, body.offsetHeight, 
        html.clientHeight, html.scrollHeight, html.offsetHeight);
}

function hideTooltip() {
    if (currentTooltip != null) {
        document.body.removeChild(currentTooltip);
        currentTooltip = null;
    }
}

/**
 * Builds the tooltip HTML for a Line.
 * @param line Line to build the tooltip for.
 */
function buildLineTooltip(line: Line) : HTMLElement {
    if (line.relOp == null) return null;
    let parser = new DOMParser();
    let actualNumberOfRows = line.relOp.actualRows != null ? 
        `<tr>
            <th>Actual Number of Rows</th>
            <td>${line.relOp.actualRows}</td>
        </tr>` : '';

    let numberOfRowsRead = line.relOp.actualRowsRead != null ?
        `<tr>
            <th>Number of Rows Read</th>
            <td>${line.relOp.actualRowsRead}</td>
        </tr>` : '';

    let document = parser.parseFromString(`
        <div class="qp-tt"><table><tbody>
        ${actualNumberOfRows}
        ${numberOfRowsRead}
        <tr>
            <th>Estimated Number of Rows</th>
            <td>${line.relOp.estimatedRows}</td>
        </tr>
        <tr>
            <th>Estimated Row Size</th>
            <td>${convertSize(line.relOp.estimatedRowSize)}</td>
        </tr>
        <tr>
            <th>Estimated Data Size</th>
            <td>${convertSize(line.relOp.estimatedDataSize)}</td>
        </tr>
        </tbody></tabke></div>
    `, "text/html");
    return <HTMLElement>document.getElementsByClassName("qp-tt")[0];
}

/**
 * Convets sizes to human readable strings.
 * @param b Size in bytes.
 */
function convertSize(b: number) : string {
    if (b >= 10000) {
        let kb = b / 1024;
        if (kb >= 10000) {
            let mb = kb / 1024;
            return `${Math.round(mb)} MB`;
        }
        return `${Math.round(kb)} KB`;
    }
    return `${b} B`;
}

export { initTooltip, buildLineTooltip, convertSize }