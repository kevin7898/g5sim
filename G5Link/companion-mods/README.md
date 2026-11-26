# Optional FS25 mods for G5Link

Download the ZIPs you want, copy them into your active FS25 profile’s `mods` folder with the filenames intact, and enable them on the save’s mod selection screen. Each ZIP contains its Lua and XML source. G5Link can also run on its own.

| Download | What it adds | Where it fits with G5Link |
| --- | --- | --- |
| [FieldPath Realistic Seeder 2.5.0.2](FS25_RealisticSeeder_split_seed_only.zip?raw=true) | Crop-specific seed, planter population in seeds/acre, drill rate in lb/acre, and equipment-dependent placement controls. The FS25 FieldPath conversion builds on work by Ifko[nator], LSFarming-Mods and DSK-Modding. | Implement Details reads the attached machine’s fill type, level and capacity. Select the implement and press **Right Ctrl + ;** in FS25 for seeder-specific rates and setup. |
| [Wheat Varieties 0.1.0.3](FS25_WheatVarieties.zip?raw=true) | Adds spring and winter wheat. Realistic Seeder includes seed products for both. | Use the two mods together to follow the selected seed product and remaining quantity on Implement Details. |
| [Dynamic Fuel Consumption 1.0.0.0](FS25_DynamicFuelConsumption.zip?raw=true) | Adjusts diesel and methane consumption with engine load and power demand. | On a diesel tractor, G5Link’s Work Monitor calculates fuel used during fieldwork from the change in tank level. |
| [Courseplay Route Guard 0.1.0.0](FS25_CourseplayRouteGuard.zip?raw=true) | Stops a single-player Courseplay helper if it cannot find a route to the next fieldwork stretch. Requires **Courseplay 8.1.0.3**. | Follow the driver on the Guidance page. The guard writes the stop reason and waypoint to the FS25 log. |

**Wheat Varieties changes saved crop data.** Try it on a copy of your save first. Keep it enabled after saving a farm that uses its crops. Its built-in June soybean window supports double cropping on Courtland. Disable the separate DoubleCropping mod when using that calendar.

All four archives passed integrity checks, XML parsing and Lua 5.1 compilation. The seeder and wheat varieties passed their source test suites. Route Guard passed its harness using Courseplay’s fieldwork strategy scripts. Live FS25 testing of these mods together with G5Link is still outstanding.
