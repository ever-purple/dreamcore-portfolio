export function FirstMixVideo() {
  return (
    <figure style={{ margin: '24px 0', width: '100%' }}>
      <video
        controls
        playsInline
        preload="none"
        poster="/product/first-mix-promo-cover.jpg"
        aria-label="FIRST MIX 产品演示视频"
        style={{ display: 'block', width: '100%', maxHeight: '75vh', aspectRatio: '1086 / 819', objectFit: 'contain', background: '#171717', borderRadius: 12 }}
      >
        <source src="/product/first-mix-promo-web.mp4" type="video/mp4" />
        <a href="/product/first-mix-promo-web.mp4">观看 FIRST MIX 产品演示</a>
      </video>
    </figure>
  );
}
