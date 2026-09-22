import { readFile, writeFile } from "node:fs/promises";

// Synthetic, repository-owned AP214 fixtures. Geometry comes from our existing
// generated box. Build assembly relationships explicitly because occt-wasm
// 4.3.1 cannot author/update assembly compounds through its public XCAF API.
const directory = new URL("../tests/fixtures/step/", import.meta.url);
const source = await readFile(new URL("box-10x20x30mm.step", directory), "utf8");
const header = source.slice(0, source.indexOf("DATA;") + 5);
const body = source.slice(source.indexOf("DATA;") + 5, source.lastIndexOf("ENDSEC;"));
const red = body.replaceAll("Open CASCADE STEP translator 8.0 1", "Red prototype");
const blue = body.replace(/#(\d+)/gu, (_, value) => `#${Number(value) + 1000}`)
  .replaceAll("Open CASCADE STEP translator 8.0 1", "Blue prototype");
let id = 2500;
const entities = [];
const add = (value) => { const result = id++; entities.push(`#${result} = ${value};`); return result; };
const assembly = (name) => {
  const product = add(`PRODUCT('${name}','${name}','',(#8))`);
  const formation = add(`PRODUCT_DEFINITION_FORMATION('','',#${product})`);
  const definition = add(`PRODUCT_DEFINITION('design','',#${formation},#9)`);
  const shape = add(`PRODUCT_DEFINITION_SHAPE('','',#${definition})`);
  const representation = add("SHAPE_REPRESENTATION('',(#11),#345)");
  add(`SHAPE_DEFINITION_REPRESENTATION(#${shape},#${representation})`);
  return { definition, representation };
};
const component = (parent, child, name, [x, y, z], rotate = false) => {
  const usage = add(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${name}','${name}','',#${parent.definition},#${child.definition},$)`);
  const shape = add(`PRODUCT_DEFINITION_SHAPE('','',#${usage})`);
  const origin = add(`CARTESIAN_POINT('',(${x}.,${y}.,${z}.))`);
  const direction = rotate ? add("DIRECTION('',(0.,1.,0.))") : 14;
  const placement = add(`AXIS2_PLACEMENT_3D('',#${origin},#13,#${direction})`);
  const transform = add(`ITEM_DEFINED_TRANSFORMATION('','',#11,#${placement})`);
  const relationship = add(`(REPRESENTATION_RELATIONSHIP('','',#${child.representation},#${parent.representation}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${transform}) SHAPE_REPRESENTATION_RELATIONSHIP())`);
  add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${relationship},#${shape})`);
};
const color = (shapeId, contextId, rgb) => {
  const rgbId = add(`COLOUR_RGB('',${rgb.map(value => `${value}.`).join(",")})`);
  const fillColor = add(`FILL_AREA_STYLE_COLOUR('',#${rgbId})`);
  const fill = add(`FILL_AREA_STYLE('',(#${fillColor}))`);
  const surface = add(`SURFACE_STYLE_FILL_AREA(#${fill})`);
  const side = add(`SURFACE_SIDE_STYLE('',(#${surface}))`);
  const usage = add(`SURFACE_STYLE_USAGE(.BOTH.,#${side})`);
  const style = add(`PRESENTATION_STYLE_ASSIGNMENT((#${usage}))`);
  const item = add(`STYLED_ITEM('',(#${style}),#${shapeId})`);
  add(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(#${item}),#${contextId})`);
};
const root = assembly("Assembly");
const nested = assembly("Nested prototype");
component(root, nested, "Nested assembly", [100, 200, 300], true);
component(nested, { definition: 5, representation: 10 }, "Red part", [10, 0, 0]);
component(nested, { definition: 1005, representation: 1010 }, "Blue part", [0, 50, 0]);
component(root, { definition: 5, representation: 10 }, "Repeated red part", [0, 0, 100]);
color(15, 345, [1, 0, 0]);
color(1015, 1345, [0, 0, 1]);
const step = `${header}\n${red}\n${blue}\n${entities.join("\n")}\nENDSEC;\nEND-ISO-10303-21;\n`;
await writeFile(new URL("colored-nested-assembly.step", directory), step);
await writeFile(new URL("colored-nested-assembly-meters.step", directory), step.replaceAll("SI_UNIT(.MILLI.,.METRE.)", "SI_UNIT($,.METRE.)"));
await writeFile(new URL("unnamed-box.step", directory), source.replaceAll("Open CASCADE STEP translator 8.0 1", ""));
console.log("Generated synthetic nested STEP assembly, meter variant, and unnamed box.");
