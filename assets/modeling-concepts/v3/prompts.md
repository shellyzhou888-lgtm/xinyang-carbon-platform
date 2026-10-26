# 全景概念生成提示词

内置 image_gen；每园区独立调用，五张输入参考，非透明背景。原始提示词如下。

## GH

Reference inputs, in order:
- `assets/modeling-concepts/v2/references/M09.jpg`
- `assets/site-photo-references/v2/01_绿色家居/01_整体体量/S01-04_万华厂区航拍.jpg`
- `assets/site-photo-references/v2/01_绿色家居/01_整体体量/S02-02_万华厂区全景.png`
- `assets/site-photo-references/v2/01_绿色家居/01_整体体量/S04-04_现代筑美信阳一期航拍.jpg`
- `assets/modeling-concepts/v2/references/S36-10.jpg`

```text
Use case: photorealistic-natural.
Asset type: whole industrial park panoramic concept for later Blender macro layout review, NOT a single factory visualization.
Create a beautiful, highly realistic, wide 16:9 aerial panorama of the entire GREEN HOME INDUSTRIAL PARK in Xinyang, synthesizing the supplied real references. This is a proposed interpretive panorama, not a surveyed reconstruction.
Input roles: image1 is the satellite spatial reference ONLY: ignore its dashboard UI, labels and imprecise red boundary; use its multiple road blocks, clustered developed southern area, large real undeveloped green parcels, separate northern long-roof cluster. Images2 and3 show the SAME Wanhua compound from different views, do not duplicate it; preserve interconnected silver production halls with unequal heights and roof monitors, one compact process zone and adjacent white multi-storey office blocks. Image4 is the 2020 Zhumei construction-stage photo: use its distinctive tightly parallel, very long shallow-pitch silver sheds and restrained red loading doors, not as proof of present construction activity. Image5 provides the Wanhua wood-panel process equipment and pipe structure only; keep the equipment a small integrated part of that compound, not a huge petrochemical refinery.
Composition: elevated oblique drone view far enough back to encompass a whole industrial district of MANY identifiable compounds and several cross streets, all foreground/midground/background in one coherent scene. Foreground has an ordinary tree-lined approach road and developed blocks; midground varied tightly packed industrial compounds on the road grid; farther green reserve parcels and a separate long-hall cluster; rural village and subtle hazy flat horizon beyond. Entire primary park composition contained inside the image with surrounding context. No single building larger than about one sixth of image width; no enormous hero hall filling foreground. Site extends in depth but don't hide all buildings behind foreground roofs.
Architecture: contrast multi-bay silver production halls, long parallel halls with red loading doors, smaller blue-roof workshops, attached lower service wings, irregular but credible yards, one restrained group of white offices. Use real structural differences, no identical repeated cube buildings. Buildings within each active compound sit close together with practical fire lanes and loading courts; retain large undeveloped parcels BETWEEN some compounds as evident in satellite. No arbitrarily huge spacing between every building. Main roads hierarchical, thinner internal drives, intersections and believable connections.
Materials: natural silver-gray corrugated roofing, subtle weathering and uneven reflection, warm off-white concrete, deep gray asphalt with small realistic markings, limited dull red and blue accents, brown soil patches. Vegetation organically irregular mixed broadleaf trees with varied heights/shapes/green tones, dense peripheral woods, thin orderly but individually varied street trees, rough grass and scrub on vacant plots, never identical spherical ornamental trees. Tiny vehicles only for scale. Neutral bright daylight, physically believable shadows, atmospheric distance, documentary drone-photo realism, natural modest saturation, sharp detailed roofscape.
Avoid: toy-town/isometric/diorama/low-poly style, floating slab, arbitrary luxury park landscaping, endless clone grid, oversized roads, cinematic orange-teal grading, perfect emerald lawn, fake signatures, map pins, red boundary, text, logos, UI, labels. Do not use rejected Blender geometry. Produce ONE full-bleed whole-park image.
```

## EI

Reference inputs, in order:
- `assets/modeling-concepts/v2/references/M15.jpg`
- `assets/modeling-concepts/v2/references/M17.jpg`
- `assets/modeling-concepts/v2/references/M19.jpg`
- `assets/site-photo-references/v2/02_电子信息/01_整体体量/S21-05_今上厂区高位全景.jpg`
- `assets/modeling-concepts/v2/references/S21-01.jpg`

```text
Use case: photorealistic-natural.
Asset type: full ELECTRONICS INDUSTRIAL PARK panoramic concept for Blender scene composition review, wide 16:9 image, documentary aerial realism.
Synthesize the supplied photos and satellite spatial evidence into ONE coherent full-park panorama of Xinyang electronics industrial corridor. This is an interpretive concept, not a survey. Cover the ENTIRE elongated industrial district and its surroundings, not just the Timeking factory.
Input roles: image1 satellite shows elongated south-to-north corridor, a principal road on west/left, rail corridor farther east/right, northern extensive blue-roof logistics buildings, southern/middle manufacturing groups and genuine green reserve parcels. Ignore dashboard UI, labels, red border and map pins. Image2 satellite shows ONE pair of adjacent long pale silver-roof Timeking halls with a narrow inner road, a small front compound and undeveloped land beyond. Image3 shows a different multi-wing/multi-building courtyard group, no verified exact ownership. Images4/5 are two actual views of the SAME Timeking pair: use cream/silver metal cladding, thin terracotta-red canopy trim, deep dark-blue shaded lower openings, shallow roof pitch, black asphalt and small gatehouse; no duplicated pair scattered throughout the park.
Composition: high oblique drone view looking along the corridor, southern developed compounds in foreground, Timeking pair in lower-middle with believable scale, courtyard manufacturing blocks in midground, reserve green/brown parcels separating select groups, extensive northern blue-roof logistics sector in distance, roads visibly tying the district together. Include the visible length of the district and surrounding fields/village, modest sky/horizon. Timeking pair occupies at most 15-20% of total image area: the whole corridor with multiple distinct sectors must remain the subject. A western boulevard on left and thin rail corridor to right establish geography; cross streets/internal lanes correspond to distinct compounds. Full district contained, not cropped to a few foreground buildings.
Architecture: natural diversity from low long production halls to compact 3-5 storey pale industrial office/courtyard buildings, service annexes, a different blue-roof northern logistics sector. Buildings inside compounds tightly grouped with realistic access/fire lanes, loading aprons, small parking. Keep truly vacant large parcels, do not fill every parcel with imaginary factories, do not uniformly space every building apart. No fantasy landmark towers, no transplanted Wanhua process towers.
Real materials: subdued silver and light warm gray roof metal with seams, restrained red-brown edge details only where referenced, dull blue roofs north, dark asphalt, faded white markings, muted yellow-brown exposed soil, uneven grassland with scrub. Individually varied deciduous canopies, poplar-like perimeter belts, dense natural wooded patches and slender young roadside trees; realistic different greens and tree sizes rather than identical garden spheres. Neutral bright daylight, coherent natural shadows, clear atmosphere and softly distant rural horizon, detailed believable infrastructure with tiny cars/trucks.
Avoid: closeup of one building, product-shot factory, model diorama, floating site slab, low-poly trees, clone buildings, enormous empty plazas, oversized roads, futuristic glass skyline, perfect golf lawn, neon green, orange-teal filter, dashboard, watermark, words, labels, logos, boundaries. Output ONE attractive full-bleed park panorama.
```
