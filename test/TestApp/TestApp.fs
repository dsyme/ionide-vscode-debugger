module TestApp

[<EntryPoint>]
let main argv =
    let t = 1
    let h = argv.Length
    let x = t + h
    printfn "%A" argv

    0 // return an integer exit code
