package main
import ("fmt"; "net"; "net/http"; "os")
func main() {
    l,err:=net.Listen("tcp","127.0.0.1:0")
    if err!=nil {panic(err)}
    fmt.Println("http://"+l.Addr().String())
    if err=http.Serve(l,http.FileServer(http.Dir(os.Args[1]))); err!=nil {panic(err)}
}
