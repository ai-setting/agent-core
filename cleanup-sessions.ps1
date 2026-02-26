$dir = "C:\Users\gddzh\.local\share\tong_work\agent-core\storage\sessions"
$files = Get-ChildItem -Path $dir -Filter "*.json"
$deleted = 0
foreach ($f in $files) {
    try {
        $content = Get-Content $f.FullName -Raw -ErrorAction Stop
        [void][Newtonsoft.Json.Linq.JToken]::Parse($content)
    } catch {
        Remove-Item $f.FullName -Force
        Write-Host $f.Name
        $deleted++
    }
}
Write-Host "Deleted: $deleted"
