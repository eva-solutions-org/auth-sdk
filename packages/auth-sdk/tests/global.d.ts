// `duplex` es requerido por Node (undici) para requests con body, pero falta en el RequestInit de lib.dom.
interface RequestInit {
  duplex?: 'half'
}
