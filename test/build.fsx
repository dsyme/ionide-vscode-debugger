#r "./packages/FAKE/tools/FakeLib.dll"

open Fake

let buildDir = "./build/"

let appReferences = !! "/**/*.fsproj"


Target "Clean" (fun _ ->
    CleanDirs [buildDir; ]
)

Target "Build" (fun _ ->
    MSBuildDebug buildDir "Build" appReferences
    |> Log "AppBuild-Output: "
)


"Clean"
  ==> "Build"


RunTargetOrDefault "Build"
