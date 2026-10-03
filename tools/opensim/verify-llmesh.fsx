// Decode a .llmesh with libopenmetaverse (the decoder OpenSimulator ships), independently of our own decoder.
//   python3 tools/opensim/opensim.py start     # downloads OpenSim; only needed for the DLLs
//   dotnet fsi tools/opensim/verify-llmesh.fsx path/to/character.llmesh   (DLL path is hard-wired to the harness work dir)
let args = fsi.CommandLineArgs
let file = args.[1]
#r "/tmp/charmorph-opensim/bin/OpenMetaverseTypes.dll"
#r "/tmp/charmorph-opensim/bin/OpenMetaverse.StructuredData.dll"
#r "/tmp/charmorph-opensim/bin/OpenMetaverse.dll"
open OpenMetaverse
open OpenMetaverse.Assets
open OpenMetaverse.Rendering
open OpenMetaverse.StructuredData

let bytes = System.IO.File.ReadAllBytes file
let a = AssetMesh(UUID.Random(), bytes)
printfn "asset decode: %b" (a.Decode())
let md = a.MeshData
printfn "blocks: %s" (String.concat ", " md.Keys)
let mutable fm : FacetedMesh = Unchecked.defaultof<FacetedMesh>
let ok = FacetedMesh.TryDecodeFromBytes(bytes, DetailLevel.High, &fm, false)
printfn "high lod decode: %b, faces %d" ok (if ok then fm.Faces.Count else 0)
if ok then for i in 0 .. fm.Faces.Count - 1 do printfn "face %d: %d vertices, %d indices" i fm.Faces.[i].Vertices.Count fm.Faces.[i].Indices.Count
if md.ContainsKey "skin" then
  let s = md.["skin"] :?> OSDMap
  printfn "skin: %d joints, %d inverse binds, alt binds %b, pelvis_offset %f"
    (s.["joint_names"] :?> OSDArray).Count (s.["inverse_bind_matrix"] :?> OSDArray).Count (s.ContainsKey "alt_inverse_bind_matrix")
    (if s.ContainsKey "pelvis_offset" then s.["pelvis_offset"].AsReal() else 0.0)
